const {
    resolveBroadcastTarget,
    buildBroadcastDraft,
    buildBroadcastPreview
} = require('../../TelegramBot/broadcastFlow');

describe('Telegram broadcast flow helper', () => {
    test('resolves supported broadcast targets', () => {
        expect(resolveBroadcastTarget('bc_target_students')).toEqual({
            target: 'students',
            label: 'Студентам'
        });
        expect(resolveBroadcastTarget('bc_target_groups')).toEqual({
            target: 'groups',
            label: 'Группам'
        });
        expect(resolveBroadcastTarget('bc_cancel')).toBeNull();
    });

    test('builds text-only draft and moves it to confirm state', () => {
        expect(buildBroadcastDraft(
            { target: 'students', state: 'awaiting_broadcast_text' },
            { text: 'Hello subscribers' }
        )).toEqual({
            target: 'students',
            state: 'awaiting_broadcast_confirm',
            text: 'Hello subscribers',
            photo: null
        });
    });

    test('builds photo draft from the largest photo size', () => {
        expect(buildBroadcastDraft(
            { target: 'groups', state: 'awaiting_broadcast_text' },
            {
                caption: 'Poster',
                photo: [{ file_id: 'small' }, { file_id: 'large' }]
            }
        )).toEqual({
            target: 'groups',
            state: 'awaiting_broadcast_confirm',
            text: 'Poster',
            photo: 'large'
        });
    });

    test('returns null for empty broadcast draft', () => {
        expect(buildBroadcastDraft(
            { target: 'students', state: 'awaiting_broadcast_text' },
            {}
        )).toBeNull();
    });

    test('builds preview text from draft', () => {
        expect(buildBroadcastPreview({
            target: 'students',
            text: 'Hello subscribers'
        })).toContain('Hello subscribers');
    });
});
