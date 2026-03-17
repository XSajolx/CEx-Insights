import React, { useState, useRef, useEffect } from 'react';

const DateRangePicker = ({ value, onChange, mode = 'intercom' }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedRange, setSelectedRange] = useState(mode === 'csat' ? 'last_90_days' : 'last_3_months');
    const getTodayString = () => new Date().toISOString().split('T')[0];
    const [startDate, setStartDate] = useState(getTodayString());
    const [endDate, setEndDate] = useState(getTodayString());
    const dropdownRef = useRef(null);

    useEffect(() => {
        if (value.startsWith('custom_')) {
            setSelectedRange('custom');
            const parts = value.split('_');
            if (parts.length === 3) {
                setStartDate(parts[1]);
                setEndDate(parts[2]);
            }
        } else {
            setSelectedRange(value);
        }
    }, [value]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Different preset ranges based on mode
    const presetRanges = mode === 'csat' ? [
        { label: 'Last 7 days', value: 'last_7_days' },
        { label: 'Last 30 days', value: 'last_30_days' },
        { label: 'Last 90 days', value: 'last_90_days' },
        { label: 'Custom', value: 'custom' }
    ] : [
        { label: 'Today', value: 'today' },
        { label: 'Yesterday', value: 'yesterday' },
        { label: 'Last 30 days', value: 'last_month' },
        { label: 'Last 90 days', value: 'last_3_months' },
        { label: 'Custom', value: 'custom' }
    ];

    const handlePresetClick = (preset, e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        setSelectedRange(preset.value);
        if (preset.value !== 'custom') {
            onChange(preset.value);
            setIsOpen(false);
        }
    };

    const handleApply = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (startDate && endDate) {
            onChange(`custom_${startDate}_${endDate}`);
            setIsOpen(false);
        }
    };

    const getDisplayText = () => {
        if (value.startsWith('custom_')) {
            const [, start, end] = value.split('_');
            return `${start} - ${end}`;
        }
        const preset = presetRanges.find(r => r.value === value);
        return preset ? preset.label : 'Select date range';
    };

    return (
        <div ref={dropdownRef} style={{ position: 'relative', minWidth: '160px' }}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    width: '100%',
                    padding: '0.5rem 0.875rem',
                    border: '1px solid #30363D',
                    borderRadius: '8px',
                    backgroundColor: '#21262D',
                    color: '#C9D1D9',
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.8125rem',
                    fontWeight: '500',
                    outline: 'none',
                    transition: 'all 0.15s ease',
                    gap: '0.5rem'
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#8B949E' }}>
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {getDisplayText()}
                    </span>
                </span>
                <span style={{
                    transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s',
                    fontSize: '0.625rem',
                    color: '#8B949E'
                }}>▼</span>
            </button>

            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: '0.25rem',
                    backgroundColor: '#1C2128',
                    border: '1px solid #30363D',
                    borderRadius: '8px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    zIndex: 1000,
                    minWidth: '320px',
                    display: 'flex'
                }}>
                    {/* Preset Ranges */}
                    <div style={{
                        padding: '0.5rem',
                        borderRight: '1px solid #30363D',
                        minWidth: '130px'
                    }}>
                        {presetRanges.map(preset => (
                            <div
                                key={preset.value}
                                onClick={(e) => handlePresetClick(preset, e)}
                                style={{
                                    padding: '0.5rem 0.75rem',
                                    cursor: 'pointer',
                                    borderRadius: '6px',
                                    fontSize: '0.8125rem',
                                    backgroundColor: selectedRange === preset.value ? 'rgba(88, 166, 255, 0.15)' : 'transparent',
                                    color: selectedRange === preset.value ? '#58A6FF' : '#C9D1D9',
                                    fontWeight: selectedRange === preset.value ? '500' : '400',
                                    marginBottom: '0.125rem',
                                    transition: 'all 0.1s ease'
                                }}
                                onMouseEnter={(e) => {
                                    if (selectedRange !== preset.value) {
                                        e.target.style.backgroundColor = '#21262D';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (selectedRange !== preset.value) {
                                        e.target.style.backgroundColor = 'transparent';
                                    }
                                }}
                            >
                                {preset.label}
                            </div>
                        ))}
                    </div>

                    {/* Custom Date Inputs */}
                    {selectedRange === 'custom' && (
                        <div style={{ padding: '0.75rem', minWidth: '180px' }}>
                            <div style={{ marginBottom: '0.75rem' }}>
                                <label style={{
                                    display: 'block',
                                    fontSize: '0.6875rem',
                                    fontWeight: '500',
                                    color: '#8B949E',
                                    marginBottom: '0.375rem',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.05em'
                                }}>
                                    From
                                </label>
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '0.5rem',
                                        border: '1px solid #30363D',
                                        borderRadius: '6px',
                                        fontSize: '0.8125rem',
                                        outline: 'none',
                                        backgroundColor: '#0D1117',
                                        color: '#C9D1D9'
                                    }}
                                    className="date-input"
                                />
                            </div>
                            <div style={{ marginBottom: '0.75rem' }}>
                                <label style={{
                                    display: 'block',
                                    fontSize: '0.6875rem',
                                    fontWeight: '500',
                                    color: '#8B949E',
                                    marginBottom: '0.375rem',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.05em'
                                }}>
                                    To
                                </label>
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '0.5rem',
                                        border: '1px solid #30363D',
                                        borderRadius: '6px',
                                        fontSize: '0.8125rem',
                                        outline: 'none',
                                        backgroundColor: '#0D1117',
                                        color: '#C9D1D9'
                                    }}
                                    className="date-input"
                                />
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                    type="button"
                                    onClick={() => setIsOpen(false)}
                                    style={{
                                        flex: 1,
                                        padding: '0.5rem',
                                        border: '1px solid #30363D',
                                        borderRadius: '6px',
                                        backgroundColor: '#21262D',
                                        color: '#C9D1D9',
                                        cursor: 'pointer',
                                        fontSize: '0.8125rem',
                                        fontWeight: '500'
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleApply}
                                    disabled={!startDate || !endDate}
                                    style={{
                                        flex: 1,
                                        padding: '0.5rem',
                                        border: 'none',
                                        borderRadius: '6px',
                                        backgroundColor: startDate && endDate ? '#58A6FF' : '#30363D',
                                        color: startDate && endDate ? '#0D1117' : '#6E7681',
                                        cursor: startDate && endDate ? 'pointer' : 'not-allowed',
                                        fontSize: '0.8125rem',
                                        fontWeight: '600'
                                    }}
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default DateRangePicker;
