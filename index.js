const fs = require("fs");
const cp = require("child_process");
const TelegramBot = require("node-telegram-bot-api");

const MAX_FILE_SIZE_IN_MB = 50;
const SPLIT_FILE_LENGTH_IN_SECONDS = 30 * 60;
const telegramBotToken = process.env["TELEGRAM_BOT_TOKEN"];

const bot = new TelegramBot(telegramBotToken, { polling: true });

bot.on("message", (msg) => {
  handler(msg);
});

async function handleSendAudio(chatId, filename) {
  const stat = fs.statSync(filename);
  const fileSizeInMB = stat.size / 1000 / 1000;

  console.log(`File info: ${filename}, size ${fileSizeInMB}`);
  if (fileSizeInMB < MAX_FILE_SIZE_IN_MB) {
    console.log(`sending file as is: ${filename}`);
    await bot.sendAudio(chatId, filename);
  } else {
    const lengthInSeconds = getLengthInSeconds(filename);
    const parts = Math.ceil(lengthInSeconds / SPLIT_FILE_LENGTH_IN_SECONDS);
    console.log(`splitting file into ${parts} parts: ${filename}`);

    for (var i = 0; i < parts; i++) {
      const offset = i * SPLIT_FILE_LENGTH_IN_SECONDS;
      const segment = getOffsetSegment(
        filename,
        offset,
        SPLIT_FILE_LENGTH_IN_SECONDS,
        i + 1,
        parts
      );

      bot.sendAudio(chatId, segment);
    }
  }
}

async function handler(msg) {
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const sender = msg.from.id;
  const url = msg.text;

  if (!/^https.+youtu/.test(url)) {
    console.log(`Message was not a URL and will be ignored: ${url}`);
    return;
  }

  await handlerImpl({
    chatId,
    messageId,
    sender,
    url,
  }).catch((e) => {
    bot.sendMessage(chatId, `Error: ${e}`);
  });
}

async function handlerImpl({ chatId, messageId, sender, url }) {
  console.log(`downloading ${url} for ${sender}`);
  const downloadingMessage = await bot.sendMessage(sender, `Downloading...`, {
    disable_web_page_preview: true,
    reply_to_message_id: messageId,
  });

  const filename = downloadAudio(url);
  await bot.deleteMessage(chatId, downloadingMessage.message_id);
  await handleSendAudio(chatId, filename);
  await bot.deleteMessage(chatId, messageId);
}

// basically all errors will get swallowed because this is someone's fetish
bot.on("polling_error", console.error);

function downloadAudio(url) {
  return handleSpawnSyncResult(
    "youtube-dl",
    cp.spawnSync("youtube-dl", [
      "-x",
      "--audio-format",
      "mp3",
      url,
      "--quiet",
      "--exec",
      "echo {}", // fuckin hell
    ])
  );
}

function getOffsetSegment(original, offset, duration, index, length) {
  const segment = `${index}-of-${length}-${original.replace(/.mp3$/, "")}.mp3`;

  handleSpawnSyncResult(
    "ffmpeg",
    cp.spawnSync("ffmpeg", [
      "-y",
      "-ss",
      offset,
      "-t",
      duration,
      "-i",
      original,
      `${segment}`,
    ])
  );

  return segment;
}

function getLengthInSeconds(filename) {
  return handleSpawnSyncResult(
    "mp3info",
    cp.spawnSync("mp3info", ["-p", "%S", filename])
  );
}

function handleSpawnSyncResult(tag, result) {
  if (result.status != 0) {
    throw new Error(`${tag} failed: ${result.stderr.toString()}`);
  } else {
    return result.stdout.toString().trim();
  }
}
