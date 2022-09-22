const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const events = require("events");
const TelegramBot = require("node-telegram-bot-api");

const db = require("./db.js");

const MAX_FILE_SIZE_IN_MB = 50;
const SPLIT_FILE_LENGTH_IN_SECONDS = 45 * 60;
const telegramBotToken = process.env["TELEGRAM_BOT_TOKEN"];

const bot = new TelegramBot(telegramBotToken, { polling: true });
const emitter = new events.EventEmitter();

bot.on("message", (msg) => {
  emitter.emit("botMessage", msg);
});

// more events to consider:
// urls to download (download and store filename to db, emit mp3 download finished)
// mp3 download finished? (split if needed, emit split jobs finished)
// split jobs finished? (get split names, send to client)
emitter.addListener("botMessage", async (msg) => {
  const chat_id = msg.chat.id;
  const message_id = msg.message_id;
  const sender = msg.from.id;

  const urls = msg.text.split("\n");

  console.log("botMessage URLs", urls);

  for await (let url of urls) {
    console.log("botMessage URL", url);
    if (!/^https.+youtu/.test(url)) {
      console.log(`Message was not a URL and will be ignored: ${url}`);
      continue;
    }

    if (url.indexOf("list") !== -1) {
      console.log(`No lists supported: ${url}`);
      continue;
    }

    await db.mkJob(url, chat_id, message_id, sender);
    console.log("botMessage finished job", url);
  }

  console.log("botMessage flushing...");
  emitter.emit("flush");
});

let busy = false;
emitter.on("flush", async () => {
  // shitty control
  if (busy) return;
  busy = true;

  console.log("Flushing...");

  const jobs = await db.getJobs();
  console.log("Jobs", jobs);

  if (jobs.length === 0) {
    console.log("nothing to flush");
    busy = false;
    return;
  }

  for await (const job of jobs) {
    console.log("handling job", job);
    await handlerImpl({
      chatId: job.chat_id,
      messageId: job.message_id,
      sender: job.sender,
      url: job.url,
    }).catch((e) => {
      bot.sendMessage(job.chat_id, `Error: ${e}`);
    });
    console.log("finished handling, deleting job");
    await db.rmJob(job.url);
    console.log("deleted");
  }

  console.log("finished flush");

  busy = false;
  emitter.emit("flush");
});

emitter.on(
  "sendAudio",
  async ({ chatId, messageId, sender, url, filename }) => {
    console.log(`sending ${url}: ${filename}`);
    const statusMessage = await bot.sendMessage(sender, `Sending...`, {
      reply_to_message_id: messageId,
    });
    await handleSendAudio({ chatId, filename, messageId, sender });
    await bot
      .deleteMessage(chatId, statusMessage.message_id)
      .catch((e) =>
        console.error(`delete failed on ${statusMessage.message_id}`)
      );
    await bot
      .deleteMessage(chatId, messageId)
      .catch((e) =>
        console.error(`delete failed on ${statusMessage.message_id}`)
      );
  }
);

// basically all errors will get swallowed because this is someone's fetish
bot.on("polling_error", console.error);

async function handlerImpl({ chatId, messageId, sender, url }) {
  const downloads = await db.getDownload(url);
  let filename;

  if (downloads.length === 0) {
    console.log(`downloading ${url} for ${sender}`);
    const downloadingMessage = await bot.sendMessage(sender, `Downloading...`, {
      disable_web_page_preview: true,
      reply_to_message_id: messageId,
    });
    filename = downloadAudio(url);
    await db.mkDownload(url, filename);
    await bot
      .deleteMessage(chatId, downloadingMessage.message_id)
      .catch((e) =>
        console.error(`delete failed on ${statusMessage.message_id}`)
      );
  } else {
    console.log(`already downloaded ${JSON.stringify(downloads)}`);
    filename = downloads[0].filename;
  }

  emitter.emit("sendAudio", { chatId, messageId, sender, url, filename });
}

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

      bot.editMessageText(
        `splitting file into ${parts} parts: ${filename}\nsending part ${
          i + 1
        }...`,
        {
          chat_id: chatId,
          message_id: splittingMessage.message_id,
        }
      );

      await bot.sendAudio(chatId, segment);
    }

    await bot
      .deleteMessage(chatId, splittingMessage.message_id)
      .catch((e) =>
        console.error(`delete failed on ${statusMessage.message_id}`)
      );
  }
}

function downloadAudio(url) {
  const opts = [
    "-x",
    "--audio-format",
    "mp3",
    url,
    "-o",
    "downloads/%(title)s.%(ext)s",
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

//flush on start
emitter.emit("flush");
