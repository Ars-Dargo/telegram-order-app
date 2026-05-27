# Инструкция по запуску

## 1. Создать Telegram бота

1. Открыть @BotFather в Telegram
2. `/newbot` → ввести название и username
3. Скопировать токен

## 2. Настроить Google Sheets

### Создать таблицу
Создайте новую Google Таблицу с тремя листами:

**Лист "Suppliers"** (поставщики):
| id | name | whatsapp | description |
|-----|------|----------|-------------|
| S1 | Хлебозавод №1 | 79001234567 | Выпечка и хлеб |
| S2 | Молочная ферма | 79009876543 | Молочные продукты |

**Лист "Products"** (товары):
| id | name | category | unit | price | supplier_id | available |
|----|------|----------|------|-------|-------------|-----------|
| P1 | Круассан с шоколадом | Выпечка | шт | 45 | S1 | TRUE |
| P2 | Круассан с сыром | Выпечка | шт | 40 | S1 | TRUE |
| P3 | Молоко 3.2% 1л | Молоко | л | 80 | S2 | TRUE |

**Лист "Orders"** (история заказов — создать пустым с заголовками):
| date | order_id | user_id | user_name | supplier_name | items | item_count |

### Подключить сервисный аккаунт Google
1. Зайти в [console.cloud.google.com](https://console.cloud.google.com)
2. Создать проект → включить **Google Sheets API**
3. IAM и администрирование → Сервисные аккаунты → Создать
4. Создать ключ (JSON) → скачать → переименовать в `google-credentials.json`
5. Положить файл в корень проекта
6. В таблице Google Sheets → Поделиться → вставить email сервисного аккаунта (из JSON поле `client_email`) с правами **Редактор**

## 3. Настроить переменные окружения

```bash
cp .env.example .env
```

Заполнить `.env`:
```
BOT_TOKEN=токен_от_BotFather
APP_URL=https://ваш-домен.com
SPREADSHEET_ID=id_из_url_таблицы
GOOGLE_KEY_FILE=./google-credentials.json
```

ID таблицы берётся из URL:  
`https://docs.google.com/spreadsheets/d/**ЭТОТ_ID**/edit`

## 4. Установить зависимости и запустить

```bash
npm install
npm start        # сервер на порту 3000
node src/bot.js  # бот
```

## 5. Сделать сервер доступным из интернета

Для теста — использовать **ngrok**:
```bash
ngrok http 3000
```
Скопировать https-адрес (например `https://abc123.ngrok.io`) → вставить в `.env` как `APP_URL`

Для продакшна — задеплоить на Railway, Render, VPS (любой хостинг с Node.js).

## 6. Зарегистрировать Mini App в BotFather

1. @BotFather → `/mybots` → выбрать бота
2. Bot Settings → Menu Button → Configure menu button
3. Ввести URL вашего приложения

## Как обновлять каталог

- Просто добавить/изменить строку в листе **Products** или **Suppliers**
- Изменения появятся в приложении через 5 минут (кэш)
- Для мгновенного обновления: POST запрос на `/api/refresh`

## Структура номера WhatsApp

Формат: только цифры, с кодом страны, без + и пробелов  
Примеры: `79001234567`, `77071234567`, `380501234567`

## Добавление нового поставщика

1. В лист **Suppliers** добавить строку с новым `id`, именем и номером WhatsApp
2. В лист **Products** добавить товары с `supplier_id` = id нового поставщика
3. Готово — через 5 минут появится в приложении
