class FakeTelegramBot {
    constructor() {
        this.textHandlers = [];
        this.eventHandlers = new Map();

        this.setMyCommands = jest.fn().mockResolvedValue(undefined);
        this.sendMessage = jest.fn().mockImplementation(async (chatId, text, options = {}) => ({
            chat: { id: chatId },
            text,
            options,
            message_id: FakeTelegramBot.nextMessageId()
        }));
        this.sendPhoto = jest.fn().mockImplementation(async (chatId, photo, options = {}) => ({
            chat: { id: chatId },
            photo,
            options,
            message_id: FakeTelegramBot.nextMessageId()
        }));
        this.editMessageText = jest.fn().mockResolvedValue(undefined);
        this.answerCallbackQuery = jest.fn().mockResolvedValue(undefined);
        this.deleteMessage = jest.fn().mockResolvedValue(undefined);
        this.getChatMember = jest.fn().mockResolvedValue({ status: 'administrator' });
        this.pinChatMessage = jest.fn().mockResolvedValue(undefined);
    }

    static nextMessageId() {
        FakeTelegramBot.messageId += 1;
        return FakeTelegramBot.messageId;
    }

    onText(regex, handler) {
        this.textHandlers.push({ regex, handler });
    }

    on(eventName, handler) {
        const handlers = this.eventHandlers.get(eventName) || [];
        handlers.push(handler);
        this.eventHandlers.set(eventName, handlers);
    }

    async emitText(text, overrides = {}) {
        const msg = {
            message_id: FakeTelegramBot.nextMessageId(),
            text,
            chat: { id: 1001, type: 'private' },
            from: { id: 1001 },
            ...overrides
        };

        for (const { regex, handler } of this.textHandlers) {
            const match = msg.text.match(regex);
            if (match) {
                await handler(msg, match);
            }
        }

        const messageHandlers = this.eventHandlers.get('message') || [];
        for (const handler of messageHandlers) {
            await handler(msg);
        }

        return msg;
    }

    async emitEvent(eventName, payload) {
        const handlers = this.eventHandlers.get(eventName) || [];
        for (const handler of handlers) {
            await handler(payload);
        }
    }
}

FakeTelegramBot.messageId = 0;

module.exports = {
    FakeTelegramBot
};
