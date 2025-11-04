# 📚 HEMIS-Notify

<div align="center">

![HEMIS-Notify Logo](https://img.shields.io/badge/HEMIS-Notify-blue?style=for-the-badge&logo=telegram)

**Автоматическая система уведомлений о расписании через Telegram**

[![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-000000?style=flat&logo=express&logoColor=white)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Telegram](https://img.shields.io/badge/Telegram-26A5E4?style=flat&logo=telegram&logoColor=white)](https://telegram.org/)

[Возможности](#-возможности) • [Использование](#-использование) • [Технологии](#-технологический-стек) • [Безопасность](#-безопасность)

</div>

---

## 📖 О проекте

**HEMIS-Notify** — это интеллектуальная система, которая интегрируется с информационной системой университета (HEMIS) и автоматически отправляет студентам их точное ежедневное расписание через Telegram-бот.

### 🎯 Ключевые преимущества

- ⏰ **Автоматические уведомления** — расписание приходит в 7:00 (на сегодня) и в 19:00 (на завтра)
- 🎓 **Точность 100%** — фильтрация по календарной дате (`lesson_date`)
- 🔄 **Автоматическая ре-аутентификация** — система сама обновляет токены при необходимости
- 🛡️ **Безопасность** — шифрование паролей AES-256, защищенные API endpoints
- 🌐 **Универсальность** — работает для всех студенческих групп

---

## ✨ Возможности

- 📅 **Получение расписания** на весь семестр из HEMIS
- 🤖 **Telegram-бот** с интуитивным интерфейсом
- 🔐 **Привязка аккаунта HEMIS** к Telegram
- 📬 **Автоматическая рассылка** расписания
- 🔄 **Перепривязка аккаунта** без потери данных
- 📊 **Умная фильтрация** занятий по датам
- ⚡ **REST API** для интеграции с другими сервисами

---

## 🛠 Технологический стек

### Backend
- **Node.js** + **Express.js** — серверная часть
- **MongoDB** + **Mongoose** — база данных
- **Crypto (AES-256)** — шифрование данных

### Telegram Bot
- **node-telegram-bot-api** — взаимодействие с Telegram API
- **node-cron** — планировщик задач
- **axios** — HTTP-запросы к backend

---

## 🚀 Использование

### Команды Telegram-бота

| Команда | Описание |
|---------|----------|
| `/start` | Начать работу с ботом |
| `/login` | Привязать аккаунт HEMIS |
| `/schedule` | Получить расписание на сегодня |
| `/tomorrow` | Получить расписание на завтра |
| `/relink` | Перепривязать аккаунт HEMIS |
| `/help` | Справка по командам |

### Пример использования

1. Запустите бот командой `/start`
2. Привяжите аккаунт HEMIS через `/login`
3. Введите логин и пароль от HEMIS
4. Получайте расписание автоматически каждый день!

---

## 🔐 Безопасность

- 🔒 **Шифрование AES-256** — пароли и данные пользователей защищены криптографией военного уровня
- 🛡️ API endpoints бота защищены секретным ключом
- 🔑 JWT токены для аутентификации
- ✅ Валидация всех входящих данных
- 🚫 Отсутствие логирования чувствительных данных

---

## 📝 Лицензия

Этот проект распространяется под лицензией MIT. Подробности в файле [LICENSE](LICENSE).

---

## 👨‍💻 Автор

**Sultanbek Otanazarov**

- GitHub: [@TheSultann](https://github.com/TheSultann)
- Telegram: [@S7L5An](https://t.me/S7L5An)
- Email: otanazarovsultanbek@gmail.com

---

## 📞 Поддержка

Если у вас возникли вопросы или проблемы:

- 💬 Напишите в Telegram: [@S7L5An](https://t.me/S7L5An)
- 📧 Email: otanazarovsultanbek@gmail.com

---

<div align="center">


⭐ Поставьте звезду, если проект вам полезен!

</div>
