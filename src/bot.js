require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);
const APP_URL = process.env.APP_URL;

bot.start((ctx) => {
  const name = ctx.from.first_name || 'друг';
  ctx.reply(
    `Привет, ${name}! 👋\n\nЗдесь вы можете быстро оформить заявку поставщикам.\n\nНажмите кнопку ниже чтобы открыть каталог:`,
    Markup.keyboard([
      [Markup.button.webApp('📦 Открыть каталог заказов', APP_URL)],
    ]).resize()
  );
});

bot.help((ctx) => {
  ctx.reply(
    'Как пользоваться:\n\n' +
    '1. Нажмите «Открыть каталог заказов»\n' +
    '2. Выберите товары и укажите количество\n' +
    '3. Нажмите «Оформить заявку»\n' +
    '4. Для каждого поставщика откроется WhatsApp с готовым сообщением — нажмите «Отправить»'
  );
});

bot.launch().then(() => {
  console.log('Bot started');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
