async function processAttendanceDiff({
    user,
    currentData,
    notifications,
    semesterCode,
    now = Date.now()
}) {
    const currentTotal = currentData.totalHours || 0;
    const lastKnown = user.lastKnownAbsentHours;

    if (user.lastSemesterCode && semesterCode && user.lastSemesterCode !== semesterCode) {
        user.lastKnownAbsentHours = currentTotal;
        user.lastSemesterCode = semesterCode;
        await user.save();
        return;
    }

    if (lastKnown === -1 || lastKnown === undefined || lastKnown === null) {
        user.lastKnownAbsentHours = currentTotal;
        user.lastSemesterCode = semesterCode;
        await user.save();
        return;
    }

    if (!user.lastSemesterCode && semesterCode) {
        user.lastSemesterCode = semesterCode;
        user.lastKnownAbsentHours = currentTotal;
        await user.save();
        return;
    }

    if (currentTotal > lastKnown) {
        const diff = currentTotal - lastKnown;
        const allDetails = [];

        if (Array.isArray(currentData.subjects)) {
            currentData.subjects.forEach((subject) => {
                if (!Array.isArray(subject.details)) {
                    return;
                }

                subject.details.forEach((detail) => {
                    allDetails.push({
                        ...detail,
                        subjectName: subject.name
                    });
                });
            });
        }

        allDetails.sort((left, right) => right.date - left.date);
        const latestNB = allDetails[0];

        if (latestNB && latestNB.date) {
            const nbDateMs = latestNB.date * 1000;
            const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
            if (nbDateMs < thirtyDaysAgo) {
                user.lastKnownAbsentHours = currentTotal;
                user.lastSemesterCode = semesterCode;
                await user.save();
                return;
            }
        }

        notifications.push({
            chatId: user.telegramChatId,
            diff,
            total: currentTotal,
            latestSubject: latestNB ? latestNB.subjectName : null,
            latestDate: latestNB ? latestNB.date : null
        });

        user.lastKnownAbsentHours = currentTotal;
        user.lastSemesterCode = semesterCode;
        await user.save();
        return;
    }

    if (currentTotal < lastKnown) {
        user.lastKnownAbsentHours = currentTotal;
        user.lastSemesterCode = semesterCode;
        await user.save();
    }
}

module.exports = {
    processAttendanceDiff
};
