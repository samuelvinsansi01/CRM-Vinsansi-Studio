import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, ChevronDown, LogOut } from 'lucide-react';
import { IconButton } from '../components';
import { navGroups, type PageId } from '../../pages/pageRegistry';
import { useAuthContext } from '../../providers/AuthProvider';

type HeaderProps = {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
};

const groupIsActive = (group: (typeof navGroups)[number], page: PageId) => {
  if (group.id === 'import-approved' && page === 'import-rejected') {
    return true;
  }

  if (group.id === page) {
    return true;
  }
  return 'items' in group && group.items.some((item) => item.id === page);
};

const activeGroupId = (page: PageId) => {
  const group = navGroups.find((item) => groupIsActive(item, page));
  return group && 'items' in group ? group.id : '';
};

export function Header({ activePage, onNavigate }: HeaderProps) {
  const [openGroup, setOpenGroup] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const currentGroupId = useMemo(() => activeGroupId(activePage), [activePage]);
  const { user, signOut } = useAuthContext();
  const firstName = user?.name?.split(' ')[0] || 'Usuario';

  useEffect(() => {
    setOpenGroup(currentGroupId);
  }, [currentGroupId]);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (navRef.current && !navRef.current.contains(target)) setOpenGroup('');
      if (profileRef.current && !profileRef.current.contains(target)) setProfileOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenGroup('');
      setProfileOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return (
    <header className="app-header">
      <div className="app-header__container">
        <button className="app-header__brand" type="button" onClick={() => onNavigate('home')}>
          Vinsansi Studio
        </button>

        <nav className="app-header__nav" aria-label="Principal" ref={navRef}>
          {navGroups.map((group) => {
            const hasItems = 'items' in group;
            const isOpen = hasItems && openGroup === group.id;

            return (
            <div
              className={`nav-item ${isOpen ? 'nav-item--open' : ''}`}
              key={group.id}
              onMouseEnter={() => hasItems && setOpenGroup(group.id)}
              onMouseLeave={() => setOpenGroup('')}
              onFocus={() => hasItems && setOpenGroup(group.id)}
            >
              <button
                className={`nav-link ${groupIsActive(group, activePage) ? 'nav-link--active' : ''}`}
                aria-expanded={hasItems ? isOpen : undefined}
                type="button"
                onClick={() => {
                  if (hasItems) setOpenGroup(group.id);
                  onNavigate(group.id as PageId);
                }}
              >
                <span>{group.label}</span>
                {hasItems ? <ChevronDown size={12} strokeWidth={1.8} /> : null}
              </button>
              {hasItems ? (
                <div className={`nav-menu ${isOpen ? 'nav-menu--open' : ''}`}>
                  {group.items.map((item) => (
                    <button key={item.id} type="button" onClick={() => { setOpenGroup(group.id); onNavigate(item.id); }}>
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            );
          })}
        </nav>

        <div className="app-header__actions">
          <span className="notification">
            <IconButton icon={Bell} label="Notificacoes" className="app-header__notification-button" />
            <span className="notification__dot" />
          </span>
          <div className={`profile-menu ${profileOpen ? 'profile-menu--open' : ''}`} ref={profileRef}>
            <button className="profile-chip" type="button" aria-expanded={profileOpen} onClick={() => setProfileOpen((current) => !current)}>
              <span className="profile-chip__avatar" aria-hidden="true" />
              <strong>{firstName}</strong>
              <ChevronDown size={16} strokeWidth={1.8} />
            </button>
            {profileOpen ? (
              <div className="profile-menu__dropdown">
                <button type="button" onClick={() => void signOut()}>
                  <LogOut size={14} strokeWidth={1.8} />
                  Sair
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
