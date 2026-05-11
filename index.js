process.env.NTBA_FIX_350 = "1";
require("dotenv").config();

const express = require("express");
const app = express();

const TelegramBot = require("node-telegram-bot-api");
const ytdlpExec = require("yt-dlp-exec");
const yts = require("yt-search");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const util = require("util");

const execFileAsync = util.promisify(execFile);

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = "VibeSaveRobot";
const BOT_LINK = `https://t.me/${BOT_USERNAME}`;

const defaultYtDlpPath = path.join(
    __dirname,
    "node_modules",
    "yt-dlp-exec",
    "bin",
    process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"
);

const YT_DLP_PATH = process.env.YT_DLP_PATH || defaultYtDlpPath;
const ytdlp = ytdlpExec.create(YT_DLP_PATH);

const GALLERY_DL_PATH =
    process.env.GALLERY_DL_PATH ||
    (process.platform === "win32"
        ? "C:\\Users\\ilhom\\AppData\\Local\\Programs\\Python\\Python313\\Scripts\\gallery-dl.exe"
        : "/opt/render/project/.venv/bin/gallery-dl");

const COOKIES_PATH = path.join(__dirname, "cookies.txt");
const DOWNLOAD_DIR = path.join(__dirname, "downloads");

app.get("/", (req, res) => {
    res.send("VibeSaveRobot ishlayapti 🔥");
});

app.listen(PORT, () => {
    console.log(`🌐 Server ${PORT} portda ishladi`);
});

if (!BOT_TOKEN) {
    console.error("❌ BOT_TOKEN .env ichida yo‘q");
    process.exit(1);
}

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const mediaCache = new Map();
const searchCache = new Map();

function isUrl(text) {
    try {
        new URL(text);
        return true;
    } catch {
        return false;
    }
}

function isInstagramUrl(url) {
    return url.toLowerCase().includes("instagram.com");
}

function hasCookies() {
    return fs.existsSync(COOKIES_PATH);
}

function safeName(name = "media") {
    return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
}

function removeFile(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

function getNewestFileByPrefix(prefix) {
    const files = fs
    .readdirSync(DOWNLOAD_DIR)
    .filter((file) => file.startsWith(prefix))
    .map((file) => ({
        name: file,
        time: fs.statSync(path.join(DOWNLOAD_DIR, file)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time);
    
    if (!files.length) return null;
    
    return path.join(DOWNLOAD_DIR, files[0].name);
}

function isImage(filePath) {
    return [".jpg", ".jpeg", ".png", ".webp"].includes(
        path.extname(filePath).toLowerCase()
    );
}

function isVideo(filePath) {
    return [".mp4", ".mov", ".mkv", ".webm"].includes(
        path.extname(filePath).toLowerCase()
    );
}

function getAddGroupKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "👥 Guruhga qo‘shish",
                    url: `${BOT_LINK}?startgroup=true`,
                },
            ],
        ],
    };
}

function getFormatKeyboard(cacheId, url) {
    if (isInstagramUrl(url)) {
        return {
            inline_keyboard: [
                [
                    {
                        text: "📥 Yuklab olish",
                        callback_data: `download_video_${cacheId}`,
                    },
                ],
                [
                    {
                        text: "👥 Guruhga qo‘shish",
                        url: `${BOT_LINK}?startgroup=true`,
                    },
                ],
            ],
        };
    }
    
    return {
        inline_keyboard: [
            [
                {
                    text: "🎬 Video",
                    callback_data: `download_video_${cacheId}`,
                },
                {
                    text: "🎧 Audio",
                    callback_data: `download_audio_${cacheId}`,
                },
            ],
            [
                {
                    text: "👥 Guruhga qo‘shish",
                    url: `${BOT_LINK}?startgroup=true`,
                },
            ],
        ],
    };
}

function getYtDlpBaseOptions() {
    const options = {
        noWarnings: true,
        noCheckCertificates: true,
    };
    
    if (hasCookies()) {
        options.cookies = COOKIES_PATH;
    }
    
    return options;
}

async function sendLoading(chatId, originalMessageId) {
    return bot
    .sendMessage(chatId, "⏳", {
        reply_to_message_id: originalMessageId,
    })
    .catch(() => null);
}

async function getMediaInfoByUrl(mediaUrl) {
    try {
        const info = await ytdlp(mediaUrl, {
            ...getYtDlpBaseOptions(),
            dumpSingleJson: true,
            skipDownload: true,
        });
        
        return {
            url: info.webpage_url || mediaUrl,
            title: info.title || "Nomsiz media",
            thumbnail: info.thumbnail || null,
            duration: info.duration_string || "Noma’lum",
            uploader: info.uploader || info.channel || "Noma’lum",
        };
    } catch (error) {
        if (
            isInstagramUrl(mediaUrl) &&
            String(error.message).includes("There is no video in this post")
        ) {
            return {
                url: mediaUrl,
                title: "Instagram post",
                thumbnail: null,
                duration: "Rasm",
                uploader: "Instagram",
            };
        }
        
        if (isInstagramUrl(mediaUrl)) {
            return {
                url: mediaUrl,
                title: "Instagram media",
                thumbnail: null,
                duration: "Noma’lum",
                uploader: "Instagram",
            };
        }
        
        throw error;
    }
}

async function sendPreview(chatId, info) {
    const cacheId = `${chatId}_${Date.now()}`;
    mediaCache.set(cacheId, info);
    
    setTimeout(() => {
        mediaCache.delete(cacheId);
    }, 1000 * 60 * 30);
    
    const caption = `
🎬 ${info.title}
    
👤 Avtor: ${info.uploader}
⏱ ${info.duration}
    
📥 Formatni tanlang
`;
    
    if (info.thumbnail) {
        await bot.sendPhoto(chatId, info.thumbnail, {
            caption,
            reply_markup: getFormatKeyboard(cacheId, info.url),
        });
    } else {
        await bot.sendMessage(chatId, caption, {
            reply_markup: getFormatKeyboard(cacheId, info.url),
        });
    }
}

async function sendSearchResults(chatId, query) {
    const result = await yts(query);
    
    if (!result.videos || !result.videos.length) {
        return bot.sendMessage(chatId, "❌ Hech narsa topilmadi");
    }
    
    const videos = result.videos.slice(0, 5);
    const searchId = `${chatId}_${Date.now()}`;
    
    searchCache.set(searchId, videos);
    
    setTimeout(() => {
        searchCache.delete(searchId);
    }, 1000 * 60 * 30);
    
    let text = `🔎 "${query}" bo‘yicha topilgan qo‘shiqlar:\n\n`;
    
    videos.forEach((video, index) => {
        text += `${index + 1}. ${video.title}\n`;
        text += `⏱ ${video.timestamp || "Noma’lum"}\n`;
        text += `👤 ${video.author?.name || "Noma’lum"}\n\n`;
    });
    
    text += "Kerakli qo‘shiqni tanlang ↓";
    
    const keyboard = videos.map((_, index) => [
        {
            text: `🎵 ${index + 1}-qo‘shiq`,
            callback_data: `select_song_${searchId}_${index}`,
        },
    ]);
    
    keyboard.push([
        {
            text: "👥 Guruhga qo‘shish",
            url: `${BOT_LINK}?startgroup=true`,
        },
    ]);
    
    await bot.sendMessage(chatId, text, {
        reply_markup: {
            inline_keyboard: keyboard,
        },
    });
}

async function downloadWithGalleryDl(url, prefix) {
    const args = [];
    
    if (hasCookies()) {
        args.push("--cookies", COOKIES_PATH);
    }
    
    args.push("-D", DOWNLOAD_DIR, "-f", `${prefix}.{extension}`, url);
    
    await execFileAsync(GALLERY_DL_PATH, args);
}

async function downloadMedia(chatId, cacheId, type, originalMessageId = null) {
    const data = mediaCache.get(cacheId);
    
    if (!data) {
        return bot.sendMessage(chatId, "❌ Ma’lumot eskirgan. Qayta yuboring.");
    }
    
    let loadingMsg = null;
    let downloadedFile = null;
    
    try {
        if (originalMessageId) {
            loadingMsg = await sendLoading(chatId, originalMessageId);
        } else {
            loadingMsg = await bot.sendMessage(chatId, "⏳").catch(() => null);
        }
        
        const title = safeName(data.title);
        const prefix = `${Date.now()}-${title}`;
        const outputTemplate = path.join(DOWNLOAD_DIR, `${prefix}.%(ext)s`);
        
        if (type === "audio") {
            await ytdlp(data.url, {
                ...getYtDlpBaseOptions(),
                output: outputTemplate,
                format: "bestaudio/best",
                extractAudio: true,
                audioFormat: "mp3",
                audioQuality: "96K",
                preferFfmpeg: true,
            });
        } else if (isInstagramUrl(data.url)) {
            await downloadWithGalleryDl(data.url, prefix);
        } else {
            await ytdlp(data.url, {
                ...getYtDlpBaseOptions(),
                output: outputTemplate,
                format: "best[height<=720][ext=mp4]/best[height<=720]/best",
                mergeOutputFormat: "mp4",
            });
        }
        
        downloadedFile = getNewestFileByPrefix(prefix);
        
        if (!downloadedFile) {
            throw new Error("Fayl topilmadi");
        }
        
        const fileSizeMb = fs.statSync(downloadedFile).size / 1024 / 1024;
        
        if (fileSizeMb > 49) {
            removeFile(downloadedFile);
            
            if (loadingMsg) {
                await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
            }
            
            return bot.sendMessage(
                chatId,
                `⚠️ Fayl juda katta: ${fileSizeMb.toFixed(1)} MB`
            );
        }
        
        const caption = `📥 @${BOT_USERNAME} orqali yuklab olindi`;
        
        if (type === "audio") {
            await bot.sendAudio(chatId, downloadedFile, {
                caption,
                title: data.title,
                reply_markup: getAddGroupKeyboard(),
                contentType: "audio/mpeg",
            });
        } else if (isImage(downloadedFile)) {
            await bot.sendPhoto(chatId, downloadedFile, {
                caption,
                reply_markup: getAddGroupKeyboard(),
            });
        } else if (isVideo(downloadedFile)) {
            await bot.sendVideo(chatId, downloadedFile, {
                caption,
                reply_markup: getAddGroupKeyboard(),
                contentType: "video/mp4",
            });
        } else {
            await bot.sendDocument(chatId, downloadedFile, {
                caption,
                reply_markup: getAddGroupKeyboard(),
            });
        }
        
        removeFile(downloadedFile);
        
        if (loadingMsg) {
            await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
        }
    } catch (error) {
        console.error("❌ Download xatolik:", error.message);
        removeFile(downloadedFile);
        
        if (loadingMsg) {
            await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
        }
        
        await bot.sendMessage(chatId, "❌ Yuklab bo‘lmadi");
    }
}

bot.onText(/\/start/, async (msg) => {
    const text = `
🔥 @${BOT_USERNAME} ga xush kelibsiz
    
Bot imkoniyatlari:
    
• Instagram post/reel/story yuklash
• Instagram rasm/video olish
• TikTok video yuklash
• YouTube video/audio
• Facebook video
• Pinterest rasm/video
• MP3 audio yuklash
    
🔎 Qo‘shiq qidirish:
• Eminem
• Konsta
• Rayhon
• Miyagi
    
🚀 Link yoki qo‘shiq nomini yuboring
`;
    
    await bot.sendMessage(msg.chat.id, text, {
        reply_markup: getAddGroupKeyboard(),
    });
});

bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();
    
    if (!text || text.startsWith("/")) return;
    
    try {
        if (!isUrl(text)) {
            return sendSearchResults(chatId, text);
        }
        
        const info = await getMediaInfoByUrl(text);
        
        if (isInstagramUrl(info.url)) {
            const cacheId = `${chatId}_${Date.now()}`;
            mediaCache.set(cacheId, info);
            
            setTimeout(() => {
                mediaCache.delete(cacheId);
            }, 1000 * 60 * 30);
            
            return downloadMedia(chatId, cacheId, "video", msg.message_id);
        }
        
        return sendPreview(chatId, info);
    } catch (error) {
        console.error("❌ Info xatolik:", error.message);
        
        await bot.sendMessage(chatId, "❌ Ma’lumot topilmadi", {
            reply_to_message_id: msg.message_id,
        });
    }
});

bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    
    await bot.answerCallbackQuery(query.id);
    
    if (data.startsWith("select_song_")) {
        const parts = data.replace("select_song_", "").split("_");
        const index = Number(parts.pop());
        const searchId = parts.join("_");
        
        const videos = searchCache.get(searchId);
        
        if (!videos || !videos[index]) {
            return bot.sendMessage(chatId, "❌ Qidiruv eskirgan");
        }
        
        const video = videos[index];
        
        const info = {
            url: video.url,
            title: video.title,
            thumbnail: video.thumbnail,
            duration: video.timestamp,
            uploader: video.author?.name || "Noma’lum",
        };
        
        return sendPreview(chatId, info);
    }
    
    if (data.startsWith("download_video_")) {
        const cacheId = data.replace("download_video_", "");
        return downloadMedia(chatId, cacheId, "video", query.message.message_id);
    }
    
    if (data.startsWith("download_audio_")) {
        const cacheId = data.replace("download_audio_", "");
        return downloadMedia(chatId, cacheId, "audio", query.message.message_id);
    }
});

bot.on("polling_error", (error) => {
    console.error("❌ Polling xatolik:", error.message);
});

console.log(`✅ @${BOT_USERNAME} ishga tushdi...`);