import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, ChevronLeft, ClipboardList, LogOut, UserRound } from 'lucide-react';
import { IconButton } from '../components';
import { navGroups, type NavGroup, type PageId } from '../../pages/pageRegistry';
import { useAuthContext } from '../../providers/AuthProvider';

type HeaderProps = {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
};

function groupItems(group: NavGroup) {
  if (group.items) return group.items;
  return group.sections?.flatMap((section) => section.items) ?? [];
}

export function Header({ activePage, onNavigate }: HeaderProps) {
  const [openGroup, setOpenGroup] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const { user, signOut } = useAuthContext();
  const firstName = user?.name?.split(' ')[0] || 'Usuário';
  const initials = (user?.name || user?.email || 'U')
    .split(/\s+/)
    .slice(0, 2)
    .map((item) => item[0]?.toUpperCase())
    .join('');

  useEffect(() => {
    const closeProfileOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (profileRef.current && !profileRef.current.contains(target)) setProfileOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenGroup('');
      setProfileOpen(false);
    };

    document.addEventListener('mousedown', closeProfileOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeProfileOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const navigate = (page: PageId) => {
    onNavigate(page);
    setOpenGroup('');
    setProfileOpen(false);
  };

  return (
    <header className="app-header">
      <div className="app-header__container">
        <button className="app-header__brand" type="button" onClick={() => navigate('home')}>
          Vinsansi Studio
        </button>

        <nav className="app-header__nav" aria-label="Principal" ref={navRef}>
          {navGroups.map((group) => {
            const items = groupItems(group);
            const hasItems = items.length > 0;
            const isOpen = hasItems && openGroup === group.id;
            const hasNestedSections = Boolean(group.sections?.length);

            return (
              <div
                className={`nav-item ${isOpen ? 'nav-item--open' : ''}`}
                key={group.id}
                onMouseEnter={() => {
                  if (!hasItems) return;
                  setOpenGroup(group.id);
                  setProfileOpen(false);
                }}
                onMouseLeave={() => setOpenGroup('')}
                onFocus={() => {
                  if (hasItems) setOpenGroup(group.id);
                }}
              >
                <button
                  className="nav-link"
                  aria-expanded={hasItems ? isOpen : undefined}
                  aria-haspopup={hasItems ? 'menu' : undefined}
                  aria-controls={hasItems ? `nav-menu-${group.id}` : undefined}
                  type="button"
                  onClick={hasItems ? undefined : () => navigate(group.id)}
                >
                  <span>{group.label}</span>
                  {hasItems ? <ChevronDown size={12} strokeWidth={1.8} /> : null}
                </button>

                {hasItems ? (
                  <div
                    className={`nav-menu ${group.menuClassName ?? ''} ${isOpen ? 'nav-menu--open' : ''}`}
                    id={`nav-menu-${group.id}`}
                    role="menu"
                    aria-label={group.label}
                  >
                    {hasNestedSections ? group.sections?.map((section) => (
                      <div className="nav-menu__cascade" key={section.label}>
                        <button
                          className="nav-menu__parent"
                          type="button"
                          role="menuitem"
                          aria-haspopup="menu"
                        >
                          <span>{section.label}</span>
                          <ChevronLeft size={14} strokeWidth={1.8} aria-hidden="true" />
                        </button>

                        <div className="nav-menu__submenu" role="menu" aria-label={section.label}>
                          {section.items.map((item) => (
                            <button
                              className={activePage === item.id ? 'nav-menu__item--active' : ''}
                              key={item.id}
                              type="button"
                              role="menuitem"
                              onClick={() => navigate(item.id)}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )) : group.items?.map((item) => (
                      <button
                        className={activePage === item.id || (item.id === 'import-approved' && activePage === 'import-rejected') ? 'nav-menu__item--active' : ''}
                        key={item.id}
                        type="button"
                        role="menuitem"
                        onClick={() => navigate(item.id)}
                      >
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
            <IconButton icon={Bell} label="Notificações" className="app-header__notification-button" />
            <span className="notification__dot" />
          </span>
          <div className={`profile-menu ${profileOpen ? 'profile-menu--open' : ''}`} ref={profileRef}>
            <button className="profile-chip" type="button" aria-expanded={profileOpen} onClick={() => setProfileOpen((current) => !current)}>
              <span
                className={`profile-chip__avatar ${user?.avatarUrl ? 'profile-chip__avatar--image' : ''}`}
                style={user?.avatarUrl ? { backgroundImage: `url(${user.avatarUrl})` } : undefined}
                aria-hidden="true"
              >
                {!user?.avatarUrl ? initials : null}
              </span>
              <strong title={user?.name}>{firstName}</strong>
              <ChevronDown size={16} strokeWidth={1.8} />
            </button>
            {profileOpen ? (
              <div className="profile-menu__dropdown">
                <button type="button" onClick={() => navigate('account')}>
                  <UserRound size={14} strokeWidth={1.8} />
                  Minha conta
                </button>
                <button type="button" onClick={() => navigate('audit')}>
                  <ClipboardList size={14} strokeWidth={1.8} />
                  Auditoria
                </button>
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
