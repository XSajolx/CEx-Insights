import React from 'react';

const LoadingSpinner = () => {
    return (
        <div className="rocket-loader-container">
            {/* Outer Ring */}
            <div className="loader-ring"></div>

            {/* Rocket Container */}
            <div className="rocket-wrapper">
                <svg className="rocket-icon" viewBox="0 0 512 512" width="100" height="100">
                    <defs>
                        <linearGradient id="rocketGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#58A6FF" />
                            <stop offset="100%" stopColor="#1F6FEB" />
                        </linearGradient>
                        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                            <feMerge>
                                <feMergeNode in="coloredBlur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>

                    {/* Rocket Body */}
                    <path
                        d="M256 16C256 16 384 128 384 272C384 374.4 345.6 464 256 496C166.4 464 128 374.4 128 272C128 128 256 16 256 16Z"
                        fill="url(#rocketGradient)"
                        filter="url(#glow)"
                    />

                    {/* Window */}
                    <circle cx="256" cy="224" r="48" fill="#0D1117" stroke="#A371F7" strokeWidth="8" />
                    <circle cx="256" cy="224" r="36" fill="#0D1117">
                        <animate attributeName="fill" values="#0D1117;#1F2428;#0D1117" dur="2s" repeatCount="indefinite" />
                    </circle>

                    {/* Fins */}
                    <path d="M128 272L64 368L128 416V272Z" fill="#161B22" stroke="#30363D" strokeWidth="4" />
                    <path d="M384 272L448 368L384 416V272Z" fill="#161B22" stroke="#30363D" strokeWidth="4" />

                    {/* Center Fin (Darker side) */}
                    <path d="M256 496V256C256 256 320 288 320 368C320 448 256 496 256 496Z" fill="rgba(0,0,0,0.2)" />
                </svg>

                {/* Exhaust Flame */}
                <div className="rocket-exhaust">
                    <div className="particle p1"></div>
                    <div className="particle p2"></div>
                    <div className="particle p3"></div>
                    <div className="particle p4"></div>
                </div>
            </div>

            <div className="loading-text">INITIALIZING LAUNCH...</div>
        </div>
    );
};

export default LoadingSpinner;
