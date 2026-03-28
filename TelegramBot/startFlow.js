function resolveStartFlow({ chatType, language, isAdmin, hasSchedule, languageLookupFailed = false }) {
    if (chatType !== 'private') {
        return { type: 'group_greeting', language: language || 'ru-RU' };
    }

    if (languageLookupFailed || !language) {
        return { type: 'select_language', language: 'ru-RU' };
    }

    if (hasSchedule) {
        return {
            type: 'welcome_back',
            language,
            menuType: isAdmin ? 'admin' : 'main'
        };
    }

    return {
        type: 'onboarding',
        language,
        nextState: 'awaiting_hemis_login'
    };
}

module.exports = {
    resolveStartFlow
};
