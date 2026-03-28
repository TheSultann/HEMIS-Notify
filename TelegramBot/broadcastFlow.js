function resolveBroadcastTarget(callbackData) {
    if (callbackData === 'bc_target_students') {
        return {
            target: 'students',
            label: 'Студентам'
        };
    }

    if (callbackData === 'bc_target_groups') {
        return {
            target: 'groups',
            label: 'Группам'
        };
    }

    return null;
}

function buildBroadcastDraft(currentDraft, message) {
    const text = message.text || message.caption || '';
    const photo = message.photo ? message.photo[message.photo.length - 1].file_id : null;

    if (!text && !photo) {
        return null;
    }

    return {
        ...currentDraft,
        text,
        photo,
        state: 'awaiting_broadcast_confirm'
    };
}

function buildBroadcastPreview(draft) {
    return `📢 <b>ПРЕДПРОСМОТР</b>\nTarget: ${draft.target}\n➖➖➖\n${draft.text}\n➖➖➖\n<i>Отправить?</i>`;
}

module.exports = {
    resolveBroadcastTarget,
    buildBroadcastDraft,
    buildBroadcastPreview
};
