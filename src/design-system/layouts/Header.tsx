import { useEffect, useRef, useState } from 'react';
import { Bell, Building2, CheckCheck, ChevronDown, LogOut, MessageCircle, Settings, TriangleAlert, UserRound, WifiOff } from 'lucide-react';
import { IconButton } from '../components';
import { navGroups, pagePermissions, pageTitles, settingsPageIds, type PageId } from '../../pages/pageRegistry';
import { useAuthContext } from '../../providers/AuthProvider';
import { useOrganizationContext } from '../../providers/OrganizationProvider';
import { useNotificationCenter } from '../../providers/NotificationCenterProvider';
import type { CrmNotification } from '../../repositories/notifications';

type HeaderProps = { activePage: PageId; onNavigate: (page: PageId) => void };

function notificationTime(value: string) {
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 45) return 'agora';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function NotificationIcon({ item }: { item: CrmNotification }) {
  if (item.type === 'whatsapp_message') return <MessageCircle size={17} strokeWidth={1.8} aria-hidden="true" />;
  if (item.type === 'whatsapp_disconnected') return <WifiOff size={17} strokeWidth={1.8} aria-hidden="true" />;
  return <TriangleAlert size={17} strokeWidth={1.8} aria-hidden="true" />;
}

export function Header({ activePage, onNavigate }: HeaderProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationFilter, setNotificationFilter] = useState<'all' | 'unread'>('all');
  const [openNavGroup, setOpenNavGroup] = useState<PageId | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const organizationRef = useRef<HTMLDivElement | null>(null);
  const notificationRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const { user, signOut } = useAuthContext();
  const { organizationId, organizations, loading: organizationLoading, hasPermission, switchOrganization } = useOrganizationContext();
  const { items: notifications, unread: hasUnreadNotifications, loading: notificationsLoading, error: notificationsError, markRead, markAllRead } = useNotificationCenter();

  const canAccessPage = (page: PageId) => {
    const permission = pagePermissions[page];
    return !permission || hasPermission(permission);
  };
  const visibleNavGroups = navGroups.filter((group) => group.items?.length ? group.items.some((item) => canAccessPage(item.id)) : canAccessPage(group.id));
  const activeOrganization = organizations.find((organization) => organization.id === organizationId) ?? organizations[0];
  const firstName = user?.name?.split(' ')[0] || 'Usuário';
  const initials = (user?.name || user?.email || 'U')
    .split(/\s+/)
    .slice(0, 2)
    .map((item) => item[0]?.toUpperCase())
    .join('');

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (profileRef.current && !profileRef.current.contains(target)) setProfileOpen(false);
      if (organizationRef.current && !organizationRef.current.contains(target)) setOrganizationOpen(false);
      if (notificationRef.current && !notificationRef.current.contains(target)) setNotificationOpen(false);
      if (navRef.current && !navRef.current.contains(target)) setOpenNavGroup(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setProfileOpen(false);
      setOrganizationOpen(false);
      setNotificationOpen(false);
      setOpenNavGroup(null);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const navigate = (page: PageId) => {
    onNavigate(page);
    setProfileOpen(false);
    setOrganizationOpen(false);
    setNotificationOpen(false);
    setOpenNavGroup(null);
  };

  const visibleNotifications = notificationFilter === 'unread' ? notifications.filter((item) => !item.readAt) : notifications;
  const openNotification = (item: CrmNotification) => {
    if (!item.readAt) void markRead(item.id).catch(() => undefined);
    const target = item.targetPage as PageId;
    if (!target || !Object.prototype.hasOwnProperty.call(pageTitles, target) || !canAccessPage(target)) {
      setNotificationOpen(false);
      return;
    }
    if (target === 'conversations') {
      window.sessionStorage.setItem('crm:notification:conversation-target', JSON.stringify(item.targetPayload));
      navigate('conversations');
      return;
    }
    if (target === 'whatsapp' || target === 'instagram') {
      window.sessionStorage.setItem(`crm:notification:queue-target:${target}`, JSON.stringify(item.targetPayload));
      navigate(target);
      return;
    }
    navigate(target);
  };

  return (
    <header className="app-header">
      <div className="app-header__container">
        <button className="app-header__brand" type="button" onClick={() => navigate('dashboard')}>Vinsansi Studio</button>

        <nav className="app-header__nav" aria-label="Principal" ref={navRef}>
          {visibleNavGroups.map((group) => {
            const visibleItems = group.items?.filter((item) => canAccessPage(item.id)) ?? [];
            const groupActive = activePage === group.id || visibleItems.some((item) => item.id === activePage);
            if (!visibleItems.length) {
              return (
                <button
                  className={`nav-link ${groupActive ? 'nav-link--active' : ''}`}
                  key={group.id}
                  type="button"
                  aria-current={groupActive ? 'page' : undefined}
                  onClick={() => navigate(group.id)}
                >
                  {group.label}
                </button>
              );
            }
            const isOpen = openNavGroup === group.id;
            return (
              <div className={`nav-item ${isOpen ? 'nav-item--open' : ''}`} key={group.id}>
                <button
                  className={`nav-link ${groupActive ? 'nav-link--active' : ''}`}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={isOpen}
                  onClick={() => {
                    setOpenNavGroup((current) => current === group.id ? null : group.id);
                    setProfileOpen(false);
                    setOrganizationOpen(false);
                    setNotificationOpen(false);
                  }}
                >
                  {group.label}
                  <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
                </button>
                <div className={`nav-menu ${isOpen ? 'nav-menu--open' : ''}`} role="menu">
                  {visibleItems.map((item) => (
                    <button type="button" role="menuitem" key={item.id} onClick={() => navigate(item.id)}>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="app-header__actions">
          {organizations.length ? (
            <div className={`organization-switcher ${organizationOpen ? 'organization-switcher--open' : ''}`} ref={organizationRef}>
              <button
                className="organization-switcher__trigger"
                type="button"
                aria-label="Organização ativa"
                aria-haspopup="listbox"
                aria-expanded={organizationOpen}
                disabled={organizationLoading}
                onClick={() => { setOrganizationOpen((current) => !current); setProfileOpen(false); setNotificationOpen(false); setOpenNavGroup(null); }}
              >
                <Building2 size={14} strokeWidth={1.8} aria-hidden="true" />
                <strong title={activeOrganization?.name}>{activeOrganization?.name ?? 'Organização'}</strong>
                <ChevronDown size={13} strokeWidth={1.8} aria-hidden="true" />
              </button>
              {organizationOpen ? (
                <div className="organization-switcher__dropdown" role="listbox" aria-label="Selecionar organização">
                  {organizations.map((organization) => {
                    const selected = organization.id === organizationId;
                    return (
                      <button
                        key={organization.id}
                        className={selected ? 'organization-switcher__option organization-switcher__option--active' : 'organization-switcher__option'}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        title={organization.name}
                        onClick={() => {
                          setOrganizationOpen(false);
                          if (!selected) void switchOrganization(organization.id);
                        }}
                      >
                        <Building2 size={14} strokeWidth={1.8} aria-hidden="true" />
                        <span>{organization.name}</span>
                        {selected ? <span className="organization-switcher__check" aria-hidden="true">✓</span> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className={`notification ${notificationOpen ? 'notification--open' : ''}`} ref={notificationRef}>
            <IconButton
              icon={Bell}
              label="Notificações"
              className="app-header__notification-button"
              aria-haspopup="dialog"
              aria-expanded={notificationOpen}
              onClick={() => { setNotificationOpen((current) => !current); setProfileOpen(false); setOrganizationOpen(false); setOpenNavGroup(null); }}
            />
            {hasUnreadNotifications ? <span className="notification__dot" aria-label="Há notificações não lidas" /> : null}
            {notificationOpen ? (
              <section className="notification-center" role="dialog" aria-label="Notificações">
                <header className="notification-center__header">
                  <div><strong>Notificações</strong><span>Atualizações que precisam da sua atenção.</span></div>
                  {hasUnreadNotifications ? (
                    <button className="notification-center__mark-all" type="button" onClick={() => void markAllRead().catch(() => undefined)}>
                      <CheckCheck size={14} strokeWidth={1.8} aria-hidden="true" />
                      Marcar todas como lidas
                    </button>
                  ) : null}
                </header>
                <div className="notification-center__tabs" role="tablist" aria-label="Filtro de notificações">
                  <button type="button" role="tab" aria-selected={notificationFilter === 'all'} className={notificationFilter === 'all' ? 'is-active' : ''} onClick={() => setNotificationFilter('all')}>Todas</button>
                  <button type="button" role="tab" aria-selected={notificationFilter === 'unread'} className={notificationFilter === 'unread' ? 'is-active' : ''} onClick={() => setNotificationFilter('unread')}>Não lidas</button>
                </div>
                <div className="notification-center__list">
                  {notificationsLoading && !notifications.length ? <div className="notification-center__empty">Carregando notificações...</div> : null}
                  {notificationsError ? <div className="notification-center__error">{notificationsError}</div> : null}
                  {!notificationsLoading && !notificationsError && !visibleNotifications.length ? <div className="notification-center__empty">{notificationFilter === 'unread' ? 'Nenhuma notificação não lida.' : 'Nenhuma notificação por aqui.'}</div> : null}
                  {visibleNotifications.map((item) => (
                    <button type="button" key={item.id} className={`notification-center__item ${item.readAt ? 'is-read' : 'is-unread'}`} onClick={() => openNotification(item)}>
                      <span className={`notification-center__icon notification-center__icon--${item.type}`}><NotificationIcon item={item} /></span>
                      <span className="notification-center__content">
                        <span className="notification-center__title">{item.title}</span>
                        <span className="notification-center__message">{item.message}</span>
                        <time>{notificationTime(item.lastEventAt)}</time>
                      </span>
                      {!item.readAt ? <span className="notification-center__unread" aria-label="Não lida" /> : null}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          {canAccessPage('settings') ? (
            <IconButton
              icon={Settings}
              label="Configurações"
              className={`app-header__settings-button ${settingsPageIds.has(activePage) ? 'is-active' : ''}`}
              onClick={() => navigate('settings')}
            />
          ) : null}

          <div className={`profile-menu ${profileOpen ? 'profile-menu--open' : ''}`} ref={profileRef}>
            <button className="profile-chip" type="button" aria-expanded={profileOpen} onClick={() => { setProfileOpen((current) => !current); setNotificationOpen(false); setOrganizationOpen(false); setOpenNavGroup(null); }}>
              <span className={`profile-chip__avatar ${user?.avatarUrl ? 'profile-chip__avatar--image' : ''}`} style={user?.avatarUrl ? { backgroundImage: `url(${user.avatarUrl})` } : undefined} aria-hidden="true">
                {!user?.avatarUrl ? initials : null}
              </span>
              <strong title={user?.name}>{firstName}</strong>
              <ChevronDown size={16} strokeWidth={1.8} />
            </button>
            {profileOpen ? (
              <div className="profile-menu__dropdown">
                <button type="button" onClick={() => navigate('account')}><UserRound size={14} strokeWidth={1.8} />Minha conta</button>
                <button type="button" onClick={() => void signOut()}><LogOut size={14} strokeWidth={1.8} />Sair</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
