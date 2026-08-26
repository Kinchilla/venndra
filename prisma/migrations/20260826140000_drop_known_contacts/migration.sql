-- Drops KnownContact, the per-user autocomplete list of addresses someone had
-- typed into an event or a saved group before.
--
-- Removed rather than merely left unread. Its only consumer was
-- components/EmailListInput, deleted alongside this migration -- both forms
-- that used it (NewEventForm, GroupForm) moved to FriendPicker some time ago,
-- so nothing had read this table in a while. It was also redundant by then:
-- lib/friends.validateAllFriends rejects any invitee who isn't already an
-- accepted friend, and recordKnownContacts ran after that check, so every row
-- here was necessarily a friend's address and derivable from Friendship.
--
-- Keeping a table of email addresses that nothing reads sat badly beside
-- issue #6, which was about not holding or showing addresses people never
-- chose to share.

-- DropForeignKey
ALTER TABLE "KnownContact" DROP CONSTRAINT "KnownContact_userId_fkey";

-- DropTable
DROP TABLE "KnownContact";
