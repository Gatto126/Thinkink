import { UserRound } from 'lucide-react';
import type { AvatarOption } from '@thinkink/shared/contracts';

export function Avatar({
  avatar,
  className = '',
  decorative = false,
}: {
  avatar: AvatarOption | null;
  className?: string;
  decorative?: boolean;
}) {
  return (
    <span className={`profile-avatar ${className}`}>
      {avatar ? (
        <img
          src={avatar.src}
          alt={decorative ? '' : avatar.label}
          width="96"
          height="96"
        />
      ) : (
        <UserRound size={28} aria-hidden="true" />
      )}
    </span>
  );
}
