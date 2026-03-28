function createLoginStart(chatType) {
    if (chatType !== 'private') {
        return { type: 'private_only' };
    }

    return {
        type: 'await_login',
        nextState: 'awaiting_hemis_login'
    };
}

function advanceLoginState(currentState, text) {
    if (currentState !== 'awaiting_hemis_login') {
        return null;
    }

    return {
        nextState: 'awaiting_hemis_password',
        hemisLogin: text
    };
}

function buildRegistrationPayload(chatId, hemisLogin, hemisPassword) {
    return {
        hemisLogin,
        hemisPassword,
        chatId: String(chatId)
    };
}

module.exports = {
    createLoginStart,
    advanceLoginState,
    buildRegistrationPayload
};
