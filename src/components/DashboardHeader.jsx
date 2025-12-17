import React, { useState } from 'react';
import './DashboardHeader.css';

const DashboardHeader = ({ activeTab, onTabChange }) => {
    const tabs = [
        { id: 'intercom', label: 'Intercom Topic', icon: '💬' },
        // Future tabs can be added here:
        // { id: 'csat', label: 'CSAT Dashboard', icon: '⭐' },
        // { id: 'sales', label: 'Sales Dashboard', icon: '📊' },
    ];

    return (
        <div className="dashboard-header">
            <h2 className="dashboard-title">Intercom Dashboard</h2>
            <p className="dashboard-subtitle">Use the filters above to customize your view.</p>

            <div className="tabs-container">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => onTabChange(tab.id)}
                        className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
                    >
                        <span className="tab-icon">{tab.icon}</span>
                        <span className="tab-label">{tab.label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
};

export default DashboardHeader;
