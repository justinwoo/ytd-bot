const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const TelegramBot = require("node-telegram-bot-api");

const MAX_FILE_SIZE_IN_MB = 50;
const SPLIT_FILE_LENGTH_IN_SECONDS = 45 * 60;
const telegramBotToken = process.env["TELEGRAM_BOT_TOKEN"];

class Subject {
  observers = [];
  items = [];
  waiting = false;

  next(value) {
    this.items.push(value);
    this.flush();
  }

  async flush() {
    if (!this.waiting && this.items.length > 0) {
      let item = this.items.shift();
      this.waiting = true;
      for (let f of this.observers) {
        await f(item);
      }
      this.waiting = false;
      this.flush();
    }
  }

  subscribe(observer) {
    this.observers.push(observer);
  }
}

const bot = new TelegramBot(telegramBotToken, { polling: true });
const subject = new Subject();

bot.on("message", (msg) => {
  subject.next(msg);
});

subject.subscribe(async (msg) => {
  await handler(msg);
});

async function handleSendAudio({ chatId, filename, sender, messageId }) {
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

    const splittingMessage = await bot.sendMessage(
      sender,
      `splitting file into ${parts} parts: ${filename}`,
      {
        reply_to_message_id: messageId,
      }
    );

    for (let i = parts - 1; i > -1; i--) {
      const offset = i * SPLIT_FILE_LENGTH_IN_SECONDS;
      const segment = getOffsetSegment(
        filename,
        offset,
        SPLIT_FILE_LENGTH_IN_SECONDS,
        i + 1,
        parts
      );

      await bot.sendAudio(chatId, segment);
    }

    await bot.deleteMessage(chatId, splittingMessage.message_id);
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

  if (url.indexOf("list") !== -1) {
    console.log(`No lists supported: ${url}`);
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

  const statusMessage = await bot.sendMessage(
    sender,
    `Downloaded audio. Sending...`,
    {
      reply_to_message_id: messageId,
    }
  );

  await bot.deleteMessage(chatId, downloadingMessage.message_id);
  await handleSendAudio({ chatId, filename, messageId, sender });
  await bot.deleteMessage(chatId, statusMessage.message_id);
  await bot.deleteMessage(chatId, messageId);
}

// basically all errors will get swallowed because this is someone's fetish
bot.on("polling_error", console.error);

function downloadAudio(url) {
  const opts = [
    "-x",
    "--audio-format",
    "mp3",
    url,
    "-o",
    "%(title)s.%(ext)s",
    "--quiet",
    "--exec",
    "echo {}", // fuckin hell
  ];

  console.log(`opts: ${opts.join(" ")}`);

  return handleSpawnSyncResult("yt-dlp", cp.spawnSync("yt-dlp", opts));
}

function getOffsetSegment(original, offset, duration, index, length) {
  const segment = `${index}-of-${length}-${path.posix.basename(original)}`;
  console.log(`segment: ${segment}`);

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
    console.error(`Error from ${tag}: ${result}`);
    throw new Error(
      `${tag} failed: ${
        result.stderr
          ? result.stderr.toString()
          : "No stderr: is this program installed?"
      }`
    );
  } else {
    return result.stdout.toString().trim();
  }
}
