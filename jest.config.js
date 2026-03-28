module.exports = {
    testEnvironment: 'node',
    testMatch: ['<rootDir>/tests/**/*.test.js'],
    setupFiles: ['<rootDir>/tests/setupEnv.js'],
    setupFilesAfterEnv: ['<rootDir>/tests/setupAfterEnv.js'],
    clearMocks: true,
    restoreMocks: true,
    maxWorkers: 1,
    collectCoverageFrom: [
        'Backend/server.js',
        'Backend/services/**/*.js',
        'Backend/models/User.js',
        'Backend/models/Group.js',
        'Backend/utils/crypto.js',
        'TelegramBot/scheduleFormatter.js',
        'TelegramBot/messageFormatter.js',
        'TelegramBot/startFlow.js',
        'TelegramBot/loginFlow.js',
        'TelegramBot/broadcastFlow.js'
    ],
    coverageDirectory: 'coverage',
    coverageProvider: 'v8',
    coverageThreshold: {
        global: {
            statements: 75,
            branches: 65,
            functions: 70,
            lines: 75
        },
        './Backend/services/hemisService.js': {
            statements: 85,
            branches: 80,
            functions: 85,
            lines: 85
        },
        './Backend/services/attendanceNotificationService.js': {
            statements: 85,
            branches: 80,
            functions: 85,
            lines: 85
        },
        './TelegramBot/scheduleFormatter.js': {
            statements: 85,
            branches: 80,
            functions: 85,
            lines: 85
        },
        './TelegramBot/messageFormatter.js': {
            statements: 85,
            branches: 80,
            functions: 85,
            lines: 85
        },
        './TelegramBot/startFlow.js': {
            statements: 85,
            branches: 80,
            functions: 85,
            lines: 85
        },
        './TelegramBot/loginFlow.js': {
            statements: 85,
            branches: 80,
            functions: 85,
            lines: 85
        },
        './TelegramBot/broadcastFlow.js': {
            statements: 85,
            branches: 80,
            functions: 85,
            lines: 85
        }
    }
};
