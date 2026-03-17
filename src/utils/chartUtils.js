/**
 * Chart utility functions for data processing and formatting
 */

/**
 * Groups data into top N items plus an "Other" category
 * @param {Array} data - Array of {name, value, ...} objects
 * @param {number} topN - Number of top items to keep separate (default: 10)
 * @param {number} minPercent - Minimum percentage to avoid grouping into Other (default: 0.5)
 * @returns {Array} Processed data with top N + Other
 */
export function topNWithOther(data, topN = 10, minPercent = 0.5) {
    if (!data || data.length === 0) return [];

    // Sort by value descending
    const sorted = [...data].sort((a, b) => b.value - a.value);

    // Calculate total
    const total = sorted.reduce((sum, item) => sum + item.value, 0);

    // Calculate minimum value threshold
    const minValue = (minPercent / 100) * total;

    // Split into top N and others
    const topItems = sorted.slice(0, topN).filter(item => item.value >= minValue);
    const otherItems = sorted.slice(topN).concat(
        sorted.slice(0, topN).filter(item => item.value < minValue)
    );

    // If there are items to group into "Other"
    if (otherItems.length > 0) {
        const otherValue = otherItems.reduce((sum, item) => sum + item.value, 0);
        const otherItem = {
            name: 'Other',
            value: otherValue,
            _children: otherItems, // Store children for tooltip
            _isOther: true
        };

        return [...topItems, otherItem];
    }

    return topItems;
}

/**
 * Calculates percentages for each item
 * @param {Array} data - Array of {name, value} objects
 * @returns {Array} Data with percentage field added
 */
export function calculatePercentages(data) {
    if (!data || data.length === 0) return [];

    const total = data.reduce((sum, item) => sum + item.value, 0);

    return data.map(item => ({
        ...item,
        percentage: total > 0 ? Math.round((item.value / total) * 100) : 0
    }));
}

/**
 * Filters data by search term (case-insensitive)
 * @param {Array} data - Array of {name, ...} objects
 * @param {string} searchTerm - Search string
 * @returns {Array} Filtered data
 */
export function filterBySearch(data, searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') return data;

    const term = searchTerm.toLowerCase().trim();
    return data.filter(item =>
        item.name.toLowerCase().includes(term)
    );
}

/**
 * Formats a percentage value
 * @param {number} value - Percentage value
 * @param {number} decimals - Number of decimal places (default: 0)
 * @returns {string} Formatted percentage string
 */
export function formatPercent(value, decimals = 0) {
    return `${value.toFixed(decimals)}%`;
}

/**
 * Truncates text with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
export function truncateText(text, maxLength = 25) {
    if (!text) return '';
    return text.length > maxLength
        ? text.substring(0, maxLength - 3) + '...'
        : text;
}
