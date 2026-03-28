const { sleep } = require('../../../Backend/services/timeService');

describe('timeService', () => {
    test('sleep resolves after timeout promise', async () => {
        await expect(sleep(0)).resolves.toBeUndefined();
    });
});
