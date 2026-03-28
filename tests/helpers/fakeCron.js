function createFakeCron() {
    const jobs = [];

    return {
        jobs,
        cron: {
            schedule: jest.fn((expression, handler, options) => {
                const job = {
                    expression,
                    handler,
                    options,
                    stop: jest.fn()
                };
                jobs.push(job);
                return job;
            })
        }
    };
}

module.exports = {
    createFakeCron
};
