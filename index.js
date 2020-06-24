const cp = require("child_process");
const TelegramBot = require("node-telegram-bot-api");

const telegramBotToken = process.env["TELEGRAM_BOT_TOKEN"];

const bot = new TelegramBot(telegramBotToken, { polling: true });

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const sender = msg.from.id;
  const url = msg.text;

  if (!/^https.+youtu/.test(url)) {
    console.log(`Message was not a URL and will be ignored: ${url}`);
    return;
  }

  console.log(`downloading ${url} for ${sender}`);
  const downloadingMessage = await bot.sendMessage(sender, `Downloading...`, {
    disable_web_page_preview: true,
    reply_to_message_id: messageId,
  });

  const result = downloadAudio(url);

  await bot.deleteMessage(chatId, downloadingMessage.message_id);

  if (result.status !== 0) {
    console.log(`Error for ${sender}@${url}: ${result.stderr}`);
    bot.sendMessage(chatId, `Error:\n${result.stderr}`);
  } else {
    await bot.deleteMessage(chatId, messageId);
    const filename = result.stdout.toString().trim();
    try {
      await bot.sendAudio(chatId, `./${filename}`);
    } catch (e) {
      bot.sendMessage(chatId, `Failed to send ${filename}:\n${e}`);
    }
  }
});

// basically all errors will get swallowed because this is someone's fetish
bot.on("polling_error", console.error);

function downloadAudio(url) {
  return cp.spawnSync("youtube-dl", [
    "-x",
    "--audio-format",
    "mp3",
    url,
    "--quiet",
    "--exec",
    "echo {}", // fuckin hell
  ]);
}
