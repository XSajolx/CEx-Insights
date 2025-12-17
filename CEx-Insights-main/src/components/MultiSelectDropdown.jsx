import React, { useState, useRef, useEffect } from 'react';

const MultiSelectDropdown = ({ options, selected, onChange, label }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const dropdownRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredOptions = options.filter(option =>
        option.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleToggle = (option) => {
        if (selected.includes(option)) {
            onChange(selected.filter(item => item !== option));
        } else {
            onChange([...selected, option]);
        }
    };

    return (
        <div ref={dropdownRef} style={{ position: 'relative', minWidth: '200px' }}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    width: '100%',
                    padding: '0.5rem 1rem',
                    border: '1px solid #D1D5DB',
                    borderRadius: '0.5rem',
                    backgroundColor: 'white',
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.875rem'
                }}
            >
                <span style={{ color: selected.length > 0 ? '#111827' : '#6B7280' }}>
                    {selected.length > 0 ? `${selected.length} selected` : `Select ${label}`}
                </span>
                <span style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
            </button>

            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: '0.25rem',
                    backgroundColor: 'white',
                    border: '1px solid #D1D5DB',
                    borderRadius: '0.5rem',
                    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                    zIndex: 1000,
                    maxHeight: '300px',
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    <div style={{ padding: '0.5rem', borderBottom: '1px solid #E5E7EB' }}>
                        <input
                            type="text"
                            placeholder="Search..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '0.5rem',
                                border: '1px solid #D1D5DB',
                                borderRadius: '0.375rem',
                                fontSize: '0.875rem',
                                outline: 'none'
                            }}
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>

                    <div style={{
                        padding: '0.5rem',
                        borderBottom: '1px solid #E5E7EB',
                        display: 'flex',
                        gap: '0.5rem'
                    }}>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onChange(options);
                            }}
                            style={{
                                flex: 1,
                                padding: '0.375rem 0.75rem',
                                backgroundColor: '#4F46E5',
                                color: 'white',
                                border: 'none',
                                borderRadius: '0.375rem',
                                fontSize: '0.75rem',
                                fontWeight: '500',
                                cursor: 'pointer',
                                transition: 'background-color 0.15s'
                            }}
                            onMouseEnter={(e) => e.target.style.backgroundColor = '#4338CA'}
                            onMouseLeave={(e) => e.target.style.backgroundColor = '#4F46E5'}
                        >
                            Select All
                        </button>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onChange([]);
                            }}
                            style={{
                                flex: 1,
                                padding: '0.375rem 0.75rem',
                                backgroundColor: '#EF4444',
                                color: 'white',
                                border: 'none',
                                borderRadius: '0.375rem',
                                fontSize: '0.75rem',
                                fontWeight: '500',
                                cursor: 'pointer',
                                transition: 'background-color 0.15s'
                            }}
                            onMouseEnter={(e) => e.target.style.backgroundColor = '#DC2626'}
                            onMouseLeave={(e) => e.target.style.backgroundColor = '#EF4444'}
                        >
                            Deselect All
                        </button>
                    </div>

                    <div style={{
                        overflowY: 'auto',
                        maxHeight: '240px',
                        padding: '0.25rem'
                    }}>
                        {filteredOptions.map(option => (
                            <div
                                key={option}
                                onClick={() => handleToggle(option)}
                                style={{
                                    padding: '0.5rem 0.75rem',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    borderRadius: '0.375rem',
                                    backgroundColor: selected.includes(option) ? '#EEF2FF' : 'transparent',
                                    transition: 'background-color 0.15s'
                                }}
                                onMouseEnter={(e) => {
                                    if (!selected.includes(option)) {
                                        e.target.style.backgroundColor = '#F9FAFB';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!selected.includes(option)) {
                                        e.target.style.backgroundColor = 'transparent';
                                    }
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={selected.includes(option)}
                                    onChange={() => { }}
                                    style={{ cursor: 'pointer' }}
                                />
                                <span style={{ fontSize: '0.875rem', color: '#111827' }}>{option}</span>
                            </div>
                        ))}
                        {filteredOptions.length === 0 && (
                            <div style={{ padding: '1rem', textAlign: 'center', color: '#6B7280', fontSize: '0.875rem' }}>
                                No results found
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default MultiSelectDropdown;
