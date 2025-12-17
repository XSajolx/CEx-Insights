import React, { useState, useRef, useEffect } from 'react';

const SearchableSelect = ({ options, value, onChange, label, disabled = false, showAllOption = true }) => {
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

    const handleSelect = (option, e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        onChange(option);
        setIsOpen(false);
        setSearchTerm('');
    };

    const getDisplayText = () => {
        if (value === 'All') return `All ${label}s`;
        return value;
    };

    return (
        <div ref={dropdownRef} style={{ position: 'relative', minWidth: '130px' }}>
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                style={{
                    width: '100%',
                    padding: '0.5rem 0.875rem',
                    border: '1px solid #30363D',
                    borderRadius: '8px',
                    backgroundColor: disabled ? '#21262D' : '#21262D',
                    color: disabled ? '#6E7681' : '#C9D1D9',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.8125rem',
                    fontWeight: '500',
                    outline: 'none',
                    transition: 'all 0.15s ease'
                }}
            >
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {getDisplayText()}
                </span>
                <span style={{
                    transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s',
                    marginLeft: '0.5rem',
                    fontSize: '0.625rem',
                    color: '#8B949E'
                }}>▼</span>
            </button>

            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: '0.25rem',
                    backgroundColor: '#1C2128',
                    border: '1px solid #30363D',
                    borderRadius: '8px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    zIndex: 1000,
                    maxHeight: '300px',
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    <div style={{ padding: '0.5rem', borderBottom: '1px solid #30363D' }}>
                        <input
                            type="text"
                            placeholder="Search..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                }
                            }}
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
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                        />
                    </div>

                    <div style={{
                        overflowY: 'auto',
                        maxHeight: '240px',
                        padding: '0.25rem'
                    }}>
                        {showAllOption && (
                            <div
                                onClick={(e) => handleSelect('All', e)}
                                style={{
                                    padding: '0.5rem 0.75rem',
                                    cursor: 'pointer',
                                    borderRadius: '6px',
                                    backgroundColor: value === 'All' ? 'rgba(88, 166, 255, 0.15)' : 'transparent',
                                    color: value === 'All' ? '#58A6FF' : '#C9D1D9',
                                    fontSize: '0.8125rem',
                                    marginBottom: '0.125rem',
                                    transition: 'all 0.1s ease'
                                }}
                                onMouseEnter={(e) => {
                                    if (value !== 'All') e.target.style.backgroundColor = '#21262D';
                                }}
                                onMouseLeave={(e) => {
                                    if (value !== 'All') e.target.style.backgroundColor = 'transparent';
                                }}
                            >
                                All {label}s
                            </div>
                        )}
                        {filteredOptions.map(option => (
                            <div
                                key={option}
                                onClick={(e) => handleSelect(option, e)}
                                style={{
                                    padding: '0.5rem 0.75rem',
                                    cursor: 'pointer',
                                    borderRadius: '6px',
                                    backgroundColor: value === option ? 'rgba(88, 166, 255, 0.15)' : 'transparent',
                                    color: value === option ? '#58A6FF' : '#C9D1D9',
                                    fontSize: '0.8125rem',
                                    marginBottom: '0.125rem',
                                    transition: 'all 0.1s ease'
                                }}
                                onMouseEnter={(e) => {
                                    if (value !== option) e.target.style.backgroundColor = '#21262D';
                                }}
                                onMouseLeave={(e) => {
                                    if (value !== option) e.target.style.backgroundColor = 'transparent';
                                }}
                            >
                                {option}
                            </div>
                        ))}
                        {filteredOptions.length === 0 && (
                            <div style={{ padding: '1rem', textAlign: 'center', color: '#6E7681', fontSize: '0.8125rem' }}>
                                No results found
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SearchableSelect;
