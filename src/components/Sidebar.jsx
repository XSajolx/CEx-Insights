import React from 'react';
import './Sidebar.css';

const Icons = {
    Topics: () => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
    ),
    CSAT: () => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
            <line x1="9" y1="9" x2="9.01" y2="9"></line>
            <line x1="15" y1="9" x2="15.01" y2="9"></line>
        </svg>
    ),
    Inflow: () => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
        </svg>
    ),
    Ticket: () => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7v2a3 3 0 0 1 3 3 3 3 0 0 1-3 3v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1-3-3 3 3 0 0 1 3-3V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z"></path>
        </svg>
    ),
    Performance: () => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"></line>
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <line x1="6" y1="20" x2="6" y2="14"></line>
        </svg>
    ),
    Country: () => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="2" y1="12" x2="22" y2="12"></line>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
        </svg>
    ),
    Sentiment: () => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
            <line x1="9" y1="9" x2="9.01" y2="9"></line>
            <line x1="15" y1="9" x2="15.01" y2="9"></line>
        </svg>
    ),
    Feedback: () => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            <line x1="12" y1="7" x2="12" y2="13"></line>
            <line x1="9" y1="10" x2="15" y2="10"></line>
        </svg>
    ),
    ChevronLeft: () => (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
    ),
    Logo: () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"></polygon>
            <line x1="12" y1="22" x2="12" y2="15.5"></line>
            <polyline points="22 8.5 12 15.5 2 8.5"></polyline>
            <polyline points="12 2 12 8.5"></polyline>
        </svg>
    )
};

const Sidebar = ({ activeTab, onTabChange, isCollapsed, onToggle }) => {
    const menuItems = [
        { id: 'intercom', label: 'Conversation Topics', icon: <Icons.Topics /> },
        { id: 'csat', label: 'CSAT', icon: <Icons.CSAT /> },
        { id: 'feedback', label: 'Feedback and Suggestion', icon: <Icons.Feedback /> },
        { id: 'inflow', label: 'Conversation Inflow', icon: <Icons.Inflow /> },
        { id: 'tickets', label: 'Ticket Inflow', icon: <Icons.Ticket /> },
        { id: 'performance', label: 'Performance Metrics', icon: <Icons.Performance /> },
        { id: 'country', label: 'Country-wise Performa...', icon: <Icons.Country /> }
    ];

    return (
        <div className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
            <div className="sidebar-header">
                <div className="sidebar-brand">
                    <div className="brand-logo">
                        <Icons.Logo />
                    </div>
                    <span className="brand-title">CEx Insights</span>
                </div>
                <button className="collapse-btn" onClick={onToggle}>
                    <Icons.ChevronLeft />
                </button>
            </div>

            <nav className="sidebar-nav">
                {menuItems.map(item => (
                    <div
                        key={item.id}
                        className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                        onClick={() => onTabChange(item.id)}
                    >
                        <span className="nav-icon">{item.icon}</span>
                        <span className="nav-label">{item.label}</span>
                    </div>
                ))}
            </nav>

            <div className="sidebar-footer">
                <span>v1.0.0 • Analytics Platform</span>
            </div>
        </div>
    );
};

export default Sidebar;
