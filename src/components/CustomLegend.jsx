import React, { useState } from 'react';
import { formatPercent, truncateText } from '../utils/chartUtils';
import './CustomLegend.css';

const CustomLegend = ({
    data = [],
    colors = [],
    onHover = () => { },
    onClick = () => { },
    maxHeight = 300
}) => {
    const [selectedItems, setSelectedItems] = useState(new Set());

    const handleItemClick = (item, index) => {
        const newSelected = new Set(selectedItems);
        if (newSelected.has(item.name)) {
            newSelected.delete(item.name);
        } else {
            newSelected.add(item.name);
        }
        setSelectedItems(newSelected);
        onClick(item, index);
    };

    const handleItemHover = (item, index, isEntering) => {
        onHover(item, index, isEntering);
    };

    const handleKeyDown = (e, item, index) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleItemClick(item, index);
        }
    };

    return (
        <div className="custom-legend">
            {/* Scrollable Legend List */}
            <div
                className="legend-list"
                style={{ maxHeight: `${maxHeight}px` }}
            >
                {data.length === 0 ? (
                    <div className="legend-empty">No topics found</div>
                ) : (
                    data.map((item, index) => {
                        // Use the color passed in the item or fallback to the colors array
                        const color = item.color || colors[index % colors.length] || '#58A6FF';
                        const isSelected = selectedItems.has(item.name);

                        return (
                            <div
                                key={item.name}
                                className={`legend-item ${isSelected ? 'selected' : ''}`}
                                onClick={() => handleItemClick(item, index)}
                                onMouseEnter={() => handleItemHover(item, index, true)}
                                onMouseLeave={() => handleItemHover(item, index, false)}
                                onKeyDown={(e) => handleKeyDown(e, item, index)}
                                role="button"
                                tabIndex={0}
                                aria-pressed={isSelected}
                                title={item.name}
                            >
                                {/* Color Dot */}
                                <span
                                    className="legend-dot"
                                    style={{ backgroundColor: color }}
                                ></span>

                                {/* Label */}
                                <span className="legend-label">
                                    {truncateText(item.name, 30)}
                                </span>

                                {/* Mini Bar */}
                                <div className="legend-bar-container">
                                    <div
                                        className="legend-bar"
                                        style={{
                                            width: `${item.percentage}%`,
                                            backgroundColor: color
                                        }}
                                    ></div>
                                </div>

                                {/* Percentage */}
                                <span className="legend-percentage">
                                    {formatPercent(item.percentage)}
                                </span>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default CustomLegend;
