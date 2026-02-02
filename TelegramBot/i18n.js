// TelegramBot/i18n.js

const translations = {
    'ru-RU': {
        // Общие
        selectLanguage: 'Выберите язык',
        languageChanged: 'Язык изменен на русский',
        loading: '⏳ Загрузка...',
        error: '❌ Ошибка',

        // Приветствие
        welcome: '👋 Добро пожаловать! Нажмите кнопку внизу для входа.',
        welcomeBack: '👋 С возвращением! Воспользуйтесь меню внизу.',
        helloGroup: '👋 Привет! Я бот HEMIS. В группах используйте /bind_me.',

        // Расписание
        scheduleFor: 'Расписание на',
        group: 'Группа',
        noLessons: 'Занятий нет. Можно отдыхать! 🎉',
        scheduleError: '❌ Ошибка получения данных. Попробуйте войти заново: /login',

        // Посещаемость
        myAttendance: 'МОЯ ПОСЕЩАЕМОСТЬ',
        totalAbsent: 'Всего пропущено',
        withoutReason: 'Без причины',
        withReason: 'По причине',
        hours: 'ч.',
        congratulations: 'Поздравляем!',
        noAbsences: 'У вас нет ни одного пропуска.',
        loadingAttendance: '⏳ Загружаю детальную статистику...',
        attendanceOnlyStudents: 'ℹ️ Эта функция доступна только для студентов.',
        attendanceError: '❌ Не удалось получить данные. Попробуйте обновить вход (/login).',
        justified: 'Уваж.',
        unjustified: 'Неуваж.',
        checkDetails: 'Проверьте детали кнопкой "🚫 Прогулы"',

        // Профиль
        yourProfile: 'Ваш профиль',
        fullName: 'ФИО',
        login: 'Логин',
        groupLabel: 'Группа',
        role: 'Роль',
        notSpecified: 'Не указана',
        student: 'Студент',
        teacher: 'Преподаватель',
        profileNotFound: '❌ Профиль не найден. Пожалуйста, войдите в систему.',

        // Авторизация
        loginOnlyPrivate: 'Вход доступен только в личных сообщениях.',
        enterHemisLogin: '🎓 <b>Авторизация в HEMIS</b>\n\n📝 Введите ваш <b>Логин</b> (ID студента):\n\n━━━━━━━━━━━━━━━━━━━━━\n🔒 <i>Ваши данные защищены шифрованием AES-256</i>',
        welcomeOnboarding: `🎓 <b>HEMIS-Notify — Telegram-бот для работы с системой HEMIS</b>\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n` +
            `📅 <b>Автоматическое расписание каждый день:</b>\n` +
            `• в 07:00 — занятия на сегодня\n` +
            `• в 19:00 — занятия на завтра\n\n` +
            `🔔 Уведомления отправляются при наличии объявления “NB”\n\n` +
            `👥 <b>Для групп:</b>\n` +
            `• Вы можете добавить бота в групповой чат\n` +
            `• Расписание и объявления будут отправляться в тот чат, куда добавлен бот\n` +
            `━━━━━━━━━━━━━━━━━━━━━`,
        enterHemisPassword: '🔐 <b>Введите пароль</b>\n\nВаш пароль от системы HEMIS:\n\n━━━━━━━━━━━━━━━━━━━━━\n🛡️ <i>Безопасность гарантирована:</i>\n• Пароль шифруется алгоритмом AES-256\n• Данные хранятся в зашифрованном виде\n• Никто не сможет войти в ваш HEMIS',
        checkingData: '🔄 Проверка данных...',
        accountLinked: '✅ Аккаунт успешно привязан.',
        selectAction: 'Выберите нужный раздел в меню 👇',
        wrongCredentials: '❌ Неверный логин или пароль.',
        serverError: '❌ Ошибка сервера.',
        tryAgain: 'Попробуйте снова.',

        // Кнопки
        lessons: '📚 Уроки',
        absences: '🚫 Прогулы',
        myProfile: '👤 Мой профиль',
        loginButton: '🔑 Вход в систему',
        changeAccount: '🔄 Сменить аккаунт',
        changeLanguage: '🌐 Сменить язык',

        // Навигация
        back: '⬅️ Назад',
        forward: 'Вперед ➡️',

        // Уведомления NB
        newAbsenceWarning: 'Внимание! Обнаружен новый пропуск (NB)!',
        subject: 'Предмет',
        date: 'Дата',
        added: 'Добавлено',
        totalAbsences: 'Всего пропусков',

        // Группы
        onlyAdmins: 'Только для админов.',
        groupBound: 'Группа успешно привязана к этому чату.',
        groupError: 'Ошибка',

        // Команды
        mainMenu: '🏠 Главное меню',
        help: 'ℹ️ Помощь'
    },
    'uz-UZ': {
        // Общие
        selectLanguage: 'Tilni tanlang',
        languageChanged: 'Til o\'zbek tiliga o\'zgartirildi',
        loading: '⏳ Yuklanmoqda...',
        error: '❌ Xatolik',

        // Приветствие
        welcome: '👋 Xush kelibsiz! Kirish uchun quyidagi tugmani bosing.',
        welcomeBack: '👋 Xush kelibsiz! Quyidagi menyudan foydalaning.',
        helloGroup: '👋 Salom! Men HEMIS botiman. Guruhlarda /bind_me dan foydalaning.',

        // Расписание
        scheduleFor: 'Jadval',
        group: 'Guruh',
        noLessons: 'Darslar yo\'q. Dam olish mumkin! 🎉',
        scheduleError: '❌ Ma\'lumotlarni olishda xatolik. Qayta kirishni urinib ko\'ring: /login',

        // Посещаемость
        myAttendance: 'MENING DAVOMATIM',
        totalAbsent: 'Jami qoldirilgan',
        withoutReason: 'Sababsiz',
        withReason: 'Sababli',
        hours: 'soat',
        congratulations: 'Tabriklaymiz!',
        noAbsences: 'Sizda hech qanday qoldirish yo\'q.',
        loadingAttendance: '⏳ Batafsil statistika yuklanmoqda...',
        attendanceOnlyStudents: 'ℹ️ Bu funksiya faqat talabalar uchun mavjud.',
        attendanceError: '❌ Ma\'lumotlarni olish mumkin emas. Kirishni yangilang (/login).',
        justified: 'Sababli',
        unjustified: 'Sababsiz',
        checkDetails: 'Batafsil ma\'lumotni "🚫 Qoldirishlar" tugmasi bilan tekshiring',

        // Профиль
        yourProfile: 'Sizning profilingiz',
        fullName: 'FIO',
        login: 'Login',
        groupLabel: 'Guruh',
        role: 'Rol',
        notSpecified: 'Ko\'rsatilmagan',
        student: 'Talaba',
        teacher: 'O\'qituvchi',
        profileNotFound: '❌ Profil topilmadi. Iltimos, tizimga kiring.',

        // Авторизация
        loginOnlyPrivate: 'Kirish faqat shaxsiy xabarlarda mavjud.',
        enterHemisLogin: '🎓 <b>HEMIS tizimiga kirish</b>\n\n📝 <b>Login</b>ingizni (Talaba ID) kiriting:\n\n━━━━━━━━━━━━━━━━━━━━━\n🔒 <i>Maʼlumotlaringiz AES-256 shifrlash bilan himoyalangan</i>',
        welcomeOnboarding: `🎓 <b>HEMIS-Notify — HEMIS tizimi bilan ishlovchi Telegram-bot</b>\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n` +
            `📅 <b>Har kuni avtomatik jadval:</b>\n` +
            `• soat 07:00 — bugungi darslar\n` +
            `• soat 19:00 — ertangi darslar\n\n` +
            `🔔 “NB” (e’lon) mavjud bo‘lsa, bot tomonidan xabarnoma yuboriladi\n\n` +
            `👥 <b>Guruhlar uchun:</b>\n` +
            `• Botni guruhga qo‘shishingiz mumkin\n` +
            `• Jadval va e’lonlar bot qo‘shilgan guruh chatiga yuboriladi`,
        enterHemisPassword: '🔐 <b>Parolni kiriting</b>\n\nHEMIS tizimidagi parolingiz:\n\n━━━━━━━━━━━━━━━━━━━━━\n🛡️ <i>Xavfsizlik kafolatlangan:</i>\n• Parol AES-256 algoritmi bilan shifrlangan\n• Maʼlumotlar shifrlangan holda saqlanadi\n• Hech kim HEMIS hisobingizga kira olmaydi',
        checkingData: '🔄 Ma\'lumotlar tekshirilmoqda...',
        accountLinked: '✅ Hisob muvaffaqiyatli bog‘landi.',
        selectAction: 'Kerakli bo‘limni menyudan tanlang 👇',
        wrongCredentials: '❌ Noto\'g\'ri login yoki parol.',
        serverError: '❌ Server xatosi.',
        tryAgain: 'Qayta urinib ko\'ring.',

        // Кнопки
        lessons: '📚 Darslar',
        absences: '🚫 Qoldirishlar',
        myProfile: '👤 Mening profilim',
        loginButton: '🔑 Tizimga kirish',
        changeAccount: '🔄 Hisobni o\'zgartirish',
        changeLanguage: '🌐 Tilni o\'zgartirish',

        // Навигация
        back: '⬅️ Orqaga',
        forward: 'Oldinga ➡️',

        // Уведомления NB
        newAbsenceWarning: 'Diqqat! Yangi qoldirish (NB) aniqlandi!',
        subject: 'Fan',
        date: 'Sana',
        added: 'Qo\'shilgan',
        totalAbsences: 'Jami qoldirishlar',

        // Группы
        onlyAdmins: 'Faqat adminlar uchun.',
        groupBound: 'Guruh muvaffaqiyatli ushbu chatga bog\'landi.',
        groupError: 'Xatolik',

        // Команды
        mainMenu: '🏠 Asosiy menyu',
        help: 'ℹ️ Yordam'
    }
};

function t(lang, key) {
    if (!lang || !translations[lang]) {
        lang = 'ru-RU'; // Fallback to Russian
    }
    return translations[lang][key] || translations['ru-RU'][key] || key;
}

function getLanguageName(lang) {
    return lang === 'ru-RU' ? 'Русский' : 'O\'zbek';
}

module.exports = { t, getLanguageName, translations };
