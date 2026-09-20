import { Link } from 'react-router-dom';

export function AuthPrompt({
  action,
  documentNavigation = false,
}: {
  action: string;
  documentNavigation?: boolean;
}) {
  return (
    <p className="auth-prompt">
      <Link to="/login" reloadDocument={documentNavigation}>
        Log in
      </Link>{' '}
      or{' '}
      <Link to="/signup" reloadDocument={documentNavigation}>
        Sign up
      </Link>{' '}
      {action}.
    </p>
  );
}
