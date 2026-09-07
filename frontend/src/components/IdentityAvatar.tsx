import { Avatar } from '@telegram-apps/telegram-ui'

interface IdentityAvatarProps {
  avatarUrl: string | null
  displayName: string
  username: string | null
  size?: 24 | 20 | 28 | 40 | 48 | 96
}

/**
 * The avatar half of every "avatar + name" identity row across the app
 * (an offer's incoming requests, the Activity tab's own sent-requests
 * row, and the admin panel's user/role/assistant lists) — the
 * username is shown as a small caption UNDER the picture itself,
 * rather than as a second text line next to the display name. That
 * caption's own space is always reserved, even for a user who has no
 * username at all, so every row in the same list stays the same
 * height instead of the shorter ones (no username) looking cramped
 * next to the taller ones that do have one.
 */
export function IdentityAvatar({ avatarUrl, displayName, username, size = 40 }: IdentityAvatarProps) {
  return (
    <span className="hp-identity-avatar">
      <Avatar size={size} src={avatarUrl ?? undefined} acronym={displayName.slice(0, 1).toUpperCase()} />
      <span className="hp-identity-username">{username ? `@${username}` : ''}</span>
    </span>
  )
}
