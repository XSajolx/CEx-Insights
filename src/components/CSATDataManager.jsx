import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../services/supabaseClient';
import { fetchCSATCategories } from '../services/api';

const PAGE_SIZE = 50;
const API_URL = '/api/analyze-topics';

const RATING_COLORS = {
    5: '#22C55E',
    4: '#86EFAC',
    3: '#FBBF24',
    2: '#F97316',
    1: '#EF4444',
};

const CSATDataManager = ({ filters }) => {
    const [rows, setRows] = useState([]);
    const [totalCount, setTotalCount] = useState(0);
    const [page, setPage] = useState(0);
    const [loading, setLoading] = useState(false);
    const [sortCol, setSortCol] = useState('Date');
    const [sortAsc, setSortAsc] = useState(false);
    const [selectedRows, setSelectedRows] = useState(new Set());
    const [editingRow, setEditingRow] = useState(null);
    const [categories, setCategories] = useState([]);
    const [subCategories, setSubCategories] = useState([]);
    const [expandedConvo, setExpandedConvo] = useState(null);
    const [convoTranscript, setConvoTranscript] = useState(null);
    const [convoLoading, setConvoLoading] = useState(false);
    const [convoError, setConvoError] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null);
    const [ratingFilter, setRatingFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const tableRef = useRef(null);

    // Load categories for edit dropdown
    useEffect(() => {
        fetchCSATCategories().then(setCategories);
    }, []);

    // Load sub-categories when editing
    useEffect(() => {
        if (!editingRow) return;
        const cat = editingRow['Concern regarding product (Catagory)'];
        if (!cat) { setSubCategories([]); return; }
        supabase
            .from('CSAT New')
            .select('"Concern regarding product (Sub-catagory)"')
            .eq('"Concern regarding product (Catagory)"', cat)
            .not('"Concern regarding product (Sub-catagory)"', 'is', null)
            .then(({ data }) => {
                const subs = [...new Set(data?.map(r => r['Concern regarding product (Sub-catagory)']).filter(Boolean))].sort();
                setSubCategories(subs);
            });
    }, [editingRow?.['Concern regarding product (Catagory)']]);

    // Fetch data
    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('CSAT New')
                .select('*', { count: 'exact' });

            // Rating filter
            if (ratingFilter !== 'all') {
                if (ratingFilter === 'low') {
                    query = query.lte('Conversation rating', 3);
                } else if (ratingFilter === 'high') {
                    query = query.gte('Conversation rating', 4);
                } else {
                    query = query.eq('Conversation rating', parseInt(ratingFilter));
                }
            }

            // Search by conversation ID
            if (searchTerm.trim()) {
                const term = searchTerm.trim();
                if (/^\d+$/.test(term)) {
                    query = query.eq('Conversation ID', parseInt(term));
                }
            }

            // Country filter from parent
            if (filters?.countries?.length > 0) {
                query = query.in('Country', filters.countries);
            }
            if (filters?.products?.length > 0) {
                query = query.in('Product Type', filters.products);
            }

            // Sort
            const ascending = sortAsc;
            query = query.order(sortCol, { ascending });

            // Pagination
            query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

            const { data, error, count } = await query;
            if (error) throw error;
            setRows(data || []);
            setTotalCount(count || 0);
        } catch (err) {
            console.error('Error fetching CSAT data:', err);
        } finally {
            setLoading(false);
        }
    }, [page, sortCol, sortAsc, ratingFilter, searchTerm, filters?.countries, filters?.products]);

    useEffect(() => { fetchData(); }, [fetchData]);
    useEffect(() => { setPage(0); }, [ratingFilter, searchTerm, filters]);

    // Sort handler
    const handleSort = (col) => {
        if (sortCol === col) setSortAsc(!sortAsc);
        else { setSortCol(col); setSortAsc(true); }
    };

    // Delete single row
    const handleDelete = async (convId) => {
        const { error } = await supabase
            .from('CSAT New')
            .delete()
            .eq('Conversation ID', convId);
        if (!error) {
            setDeleteConfirm(null);
            fetchData();
        }
    };

    // Bulk delete
    const handleBulkDelete = async () => {
        if (selectedRows.size === 0) return;
        const ids = Array.from(selectedRows);
        // Delete in batches of 100
        for (let i = 0; i < ids.length; i += 100) {
            const batch = ids.slice(i, i + 100);
            await supabase.from('CSAT New').delete().in('Conversation ID', batch);
        }
        setSelectedRows(new Set());
        setDeleteConfirm(null);
        fetchData();
    };

    // Update category
    const handleSaveEdit = async () => {
        if (!editingRow) return;
        const { error } = await supabase
            .from('CSAT New')
            .update({
                'Concern regarding product (Catagory)': editingRow['Concern regarding product (Catagory)'] || null,
                'Concern regarding product (Sub-catagory)': editingRow['Concern regarding product (Sub-catagory)'] || null,
            })
            .eq('Conversation ID', editingRow['Conversation ID']);
        if (!error) {
            setEditingRow(null);
            fetchData();
        }
    };

    // Pull conversation from Intercom
    const handlePullConversation = async (convId) => {
        if (expandedConvo === convId) {
            setExpandedConvo(null);
            setConvoTranscript(null);
            return;
        }
        setExpandedConvo(convId);
        setConvoTranscript(null);
        setConvoLoading(true);
        setConvoError(null);
        try {
            const res = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'fetch-details', conversationId: String(convId) }),
            });
            const json = await res.json();
            if (json.success && json.data) {
                setConvoTranscript(json.data);
            } else {
                setConvoError(json.error || 'Failed to fetch conversation');
            }
        } catch (err) {
            setConvoError(err.message);
        } finally {
            setConvoLoading(false);
        }
    };

    // Select all on page
    const toggleSelectAll = () => {
        if (selectedRows.size === rows.length) {
            setSelectedRows(new Set());
        } else {
            setSelectedRows(new Set(rows.map(r => r['Conversation ID'])));
        }
    };

    const toggleSelect = (convId) => {
        setSelectedRows(prev => {
            const next = new Set(prev);
            if (next.has(convId)) next.delete(convId);
            else next.add(convId);
            return next;
        });
    };

    const totalPages = Math.ceil(totalCount / PAGE_SIZE);

    const SortIcon = ({ col }) => {
        if (sortCol !== col) return <span style={{ opacity: 0.3, marginLeft: 4 }}>&#8597;</span>;
        return <span style={{ marginLeft: 4, color: 'var(--accent)' }}>{sortAsc ? '&#9650;' : '&#9660;'}</span>;
    };

    return (
        <div className="csat-data-manager">
            {/* Header */}
            <div className="csat-dm-header">
                <div className="csat-dm-title-row">
                    <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                        CSAT Data
                    </h3>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 8 }}>
                        {totalCount.toLocaleString()} records
                    </span>
                </div>

                {/* Controls */}
                <div className="csat-dm-controls">
                    {/* Search */}
                    <div className="csat-dm-search">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                        <input
                            type="text"
                            placeholder="Search by Conversation ID..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    {/* Rating filter */}
                    <select
                        className="csat-dm-select"
                        value={ratingFilter}
                        onChange={(e) => setRatingFilter(e.target.value)}
                    >
                        <option value="all">All Ratings</option>
                        <option value="high">High (4-5)</option>
                        <option value="low">Low (1-3)</option>
                        <option value="5">5 Stars</option>
                        <option value="4">4 Stars</option>
                        <option value="3">3 Stars</option>
                        <option value="2">2 Stars</option>
                        <option value="1">1 Star</option>
                    </select>

                    {/* Bulk delete */}
                    {selectedRows.size > 0 && (
                        <button
                            className="csat-dm-btn csat-dm-btn-danger"
                            onClick={() => setDeleteConfirm('bulk')}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            Delete {selectedRows.size} selected
                        </button>
                    )}
                </div>
            </div>

            {/* Table */}
            <div className="csat-dm-table-wrap" ref={tableRef}>
                <table className="csat-dm-table">
                    <thead>
                        <tr>
                            <th style={{ width: 36 }}>
                                <input
                                    type="checkbox"
                                    checked={rows.length > 0 && selectedRows.size === rows.length}
                                    onChange={toggleSelectAll}
                                />
                            </th>
                            <th onClick={() => handleSort('Date')} style={{ cursor: 'pointer' }}>
                                Date <SortIcon col="Date" />
                            </th>
                            <th onClick={() => handleSort('Conversation ID')} style={{ cursor: 'pointer' }}>
                                Conversation ID <SortIcon col="Conversation ID" />
                            </th>
                            <th onClick={() => handleSort('Conversation rating')} style={{ cursor: 'pointer', width: 70 }}>
                                Rating <SortIcon col="Conversation rating" />
                            </th>
                            <th>Country</th>
                            <th>Product</th>
                            <th>Category</th>
                            <th>Sub-Category</th>
                            <th style={{ width: 130 }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && rows.length === 0 ? (
                            <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Loading...</td></tr>
                        ) : rows.length === 0 ? (
                            <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No records found</td></tr>
                        ) : rows.map((row) => (
                            <React.Fragment key={row['Conversation ID']}>
                                <tr className={selectedRows.has(row['Conversation ID']) ? 'selected' : ''}>
                                    <td>
                                        <input
                                            type="checkbox"
                                            checked={selectedRows.has(row['Conversation ID'])}
                                            onChange={() => toggleSelect(row['Conversation ID'])}
                                        />
                                    </td>
                                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.8125rem' }}>{row.Date}</td>
                                    <td>
                                        <button
                                            className="csat-dm-convo-id"
                                            onClick={() => handlePullConversation(row['Conversation ID'])}
                                            title="Click to pull conversation"
                                        >
                                            {row['Conversation ID']}
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 4, flexShrink: 0 }}>
                                                {expandedConvo === row['Conversation ID']
                                                    ? <polyline points="18 15 12 9 6 15"/>
                                                    : <polyline points="6 9 12 15 18 9"/>
                                                }
                                            </svg>
                                        </button>
                                    </td>
                                    <td>
                                        <span className="csat-dm-rating" style={{ background: RATING_COLORS[row['Conversation rating']] + '22', color: RATING_COLORS[row['Conversation rating']], borderColor: RATING_COLORS[row['Conversation rating']] + '44' }}>
                                            {'★'.repeat(row['Conversation rating'])}
                                        </span>
                                    </td>
                                    <td style={{ fontSize: '0.8125rem' }}>{row.Country || '-'}</td>
                                    <td style={{ fontSize: '0.8125rem' }}>{row['Product Type'] || '-'}</td>
                                    <td style={{ fontSize: '0.8125rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {row['Concern regarding product (Catagory)'] || <span style={{ color: 'var(--text-dim)' }}>-</span>}
                                    </td>
                                    <td style={{ fontSize: '0.8125rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {row['Concern regarding product (Sub-catagory)'] || <span style={{ color: 'var(--text-dim)' }}>-</span>}
                                    </td>
                                    <td>
                                        <div className="csat-dm-actions">
                                            <button
                                                className="csat-dm-action-btn"
                                                title="Edit category"
                                                onClick={() => setEditingRow({ ...row })}
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                            </button>
                                            <button
                                                className="csat-dm-action-btn danger"
                                                title="Delete"
                                                onClick={() => setDeleteConfirm(row['Conversation ID'])}
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                                {/* Expanded conversation transcript */}
                                {expandedConvo === row['Conversation ID'] && (
                                    <tr className="csat-dm-convo-row">
                                        <td colSpan={9}>
                                            <ConversationPanel
                                                loading={convoLoading}
                                                error={convoError}
                                                data={convoTranscript}
                                                onClose={() => { setExpandedConvo(null); setConvoTranscript(null); }}
                                            />
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="csat-dm-pagination">
                    <button
                        className="csat-dm-page-btn"
                        disabled={page === 0}
                        onClick={() => setPage(0)}
                    >
                        &laquo;
                    </button>
                    <button
                        className="csat-dm-page-btn"
                        disabled={page === 0}
                        onClick={() => setPage(p => p - 1)}
                    >
                        &lsaquo;
                    </button>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', padding: '0 0.75rem' }}>
                        Page {page + 1} of {totalPages}
                    </span>
                    <button
                        className="csat-dm-page-btn"
                        disabled={page >= totalPages - 1}
                        onClick={() => setPage(p => p + 1)}
                    >
                        &rsaquo;
                    </button>
                    <button
                        className="csat-dm-page-btn"
                        disabled={page >= totalPages - 1}
                        onClick={() => setPage(totalPages - 1)}
                    >
                        &raquo;
                    </button>
                </div>
            )}

            {/* Edit Modal */}
            {editingRow && (
                <div className="csat-dm-modal-backdrop" onClick={() => setEditingRow(null)}>
                    <div className="csat-dm-modal" onClick={e => e.stopPropagation()}>
                        <div className="csat-dm-modal-header">
                            <h4 style={{ margin: 0, fontSize: '0.9375rem' }}>Edit Category</h4>
                            <button className="csat-dm-close" onClick={() => setEditingRow(null)}>&times;</button>
                        </div>
                        <div className="csat-dm-modal-body">
                            <div style={{ marginBottom: '0.75rem', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                                Conversation ID: {editingRow['Conversation ID']}
                            </div>
                            <label className="csat-dm-label">Category</label>
                            <select
                                className="csat-dm-input"
                                value={editingRow['Concern regarding product (Catagory)'] || ''}
                                onChange={(e) => setEditingRow(prev => ({
                                    ...prev,
                                    'Concern regarding product (Catagory)': e.target.value || null,
                                    'Concern regarding product (Sub-catagory)': null,
                                }))}
                            >
                                <option value="">-- None --</option>
                                {categories.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>

                            <label className="csat-dm-label" style={{ marginTop: '0.75rem' }}>Sub-Category</label>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <select
                                    className="csat-dm-input"
                                    style={{ flex: 1 }}
                                    value={editingRow['Concern regarding product (Sub-catagory)'] || ''}
                                    onChange={(e) => setEditingRow(prev => ({
                                        ...prev,
                                        'Concern regarding product (Sub-catagory)': e.target.value || null,
                                    }))}
                                >
                                    <option value="">-- None --</option>
                                    {subCategories.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <input
                                    type="text"
                                    className="csat-dm-input"
                                    style={{ flex: 1 }}
                                    placeholder="Or type custom..."
                                    value={editingRow['Concern regarding product (Sub-catagory)'] || ''}
                                    onChange={(e) => setEditingRow(prev => ({
                                        ...prev,
                                        'Concern regarding product (Sub-catagory)': e.target.value || null,
                                    }))}
                                />
                            </div>
                        </div>
                        <div className="csat-dm-modal-footer">
                            <button className="csat-dm-btn" onClick={() => setEditingRow(null)}>Cancel</button>
                            <button className="csat-dm-btn csat-dm-btn-primary" onClick={handleSaveEdit}>Save</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation */}
            {deleteConfirm && (
                <div className="csat-dm-modal-backdrop" onClick={() => setDeleteConfirm(null)}>
                    <div className="csat-dm-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
                        <div className="csat-dm-modal-header">
                            <h4 style={{ margin: 0, fontSize: '0.9375rem', color: 'var(--neon-red)' }}>Confirm Delete</h4>
                        </div>
                        <div className="csat-dm-modal-body">
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
                                {deleteConfirm === 'bulk'
                                    ? `Delete ${selectedRows.size} selected record${selectedRows.size > 1 ? 's' : ''}? This cannot be undone.`
                                    : 'Delete this CSAT record? This cannot be undone.'
                                }
                            </p>
                        </div>
                        <div className="csat-dm-modal-footer">
                            <button className="csat-dm-btn" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                            <button
                                className="csat-dm-btn csat-dm-btn-danger"
                                onClick={() => deleteConfirm === 'bulk' ? handleBulkDelete() : handleDelete(deleteConfirm)}
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

/* Conversation Panel Sub-component */
const ConversationPanel = ({ loading, error, data, onClose }) => {
    if (loading) {
        return (
            <div className="csat-dm-convo-panel">
                <div className="csat-dm-convo-loading">
                    <div className="csat-dm-spinner" />
                    <span>Pulling conversation from Intercom...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="csat-dm-convo-panel">
                <div style={{ color: 'var(--neon-red)', fontSize: '0.8125rem', padding: '1rem' }}>
                    Error: {error}
                </div>
            </div>
        );
    }

    if (!data) return null;

    const transcript = data.Transcript || data.transcript || '';
    const messages = transcript.split('\n').filter(Boolean);

    return (
        <div className="csat-dm-convo-panel">
            <div className="csat-dm-convo-header">
                <div className="csat-dm-convo-meta">
                    {data.Email && <span><strong>Email:</strong> {data.Email}</span>}
                    {data.Country && <span><strong>Country:</strong> {data.Country}</span>}
                    {data.Product && <span><strong>Product:</strong> {data.Product}</span>}
                    {data['Conversation rating'] && <span><strong>Rating:</strong> {'★'.repeat(data['Conversation rating'])}</span>}
                    {data['Conversation rating remark'] && <span><strong>Remark:</strong> {data['Conversation rating remark']}</span>}
                </div>
                <button className="csat-dm-close" onClick={onClose} title="Close">&times;</button>
            </div>
            <div className="csat-dm-convo-messages">
                {messages.length > 0 ? messages.map((msg, i) => {
                    const isUser = msg.startsWith('USER:') || msg.startsWith('CUSTOMER:');
                    const isBot = msg.startsWith('BOT:') || msg.startsWith('FIN:');
                    const isAgent = msg.startsWith('AGENT:') || msg.startsWith('ADMIN:');
                    const role = isUser ? 'user' : isBot ? 'bot' : isAgent ? 'agent' : 'system';
                    const content = msg.replace(/^(USER|CUSTOMER|AGENT|ADMIN|BOT|FIN):\s*/, '');

                    return (
                        <div key={i} className={`csat-dm-msg csat-dm-msg-${role}`}>
                            <div className="csat-dm-msg-role">
                                {isUser ? 'Customer' : isBot ? 'FIN Bot' : isAgent ? 'Agent' : 'System'}
                            </div>
                            <div className="csat-dm-msg-text">{content}</div>
                        </div>
                    );
                }) : (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', padding: '1rem', textAlign: 'center' }}>
                        No transcript available
                    </div>
                )}
            </div>
        </div>
    );
};

export default CSATDataManager;
