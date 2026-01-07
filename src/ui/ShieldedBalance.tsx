/**
 * Shielded Balance Component
 * 
 * Displays the receiver's shielded balance in a clean way.
 * 
 * IMPORTANT: This component does NOT show withdraw buttons by default.
 * The receiver sees their balance and can use it for further private
 * transactions. Withdrawing is OPTIONAL and can be enabled if needed.
 */

import React, { useEffect, useState } from 'react';
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { ReceiverScanner, ScannerEvent } from '../scanner/index.js';
import { ShieldedBalance as ShieldedBalanceType, ScannedNote } from '../types.js';

/**
 * Props for the ShieldedBalance component
 */
interface ShieldedBalanceProps {
  /** The receiver's wallet keypair */
  walletKeypair: Keypair;
  
  /** Optional: Show withdraw button (default: false) */
  showWithdraw?: boolean;
  
  /** Optional: Custom styling */
  className?: string;
  
  /** Callback when new funds are received */
  onFundsReceived?: (amount: bigint) => void;
}

/**
 * Shielded Balance Display
 */
export function ShieldedBalanceDisplay({
  walletKeypair,
  showWithdraw = false,
  className = '',
  onFundsReceived,
}: ShieldedBalanceProps) {
  const [balance, setBalance] = useState<ShieldedBalanceType | null>(null);
  const [recentNotes, setRecentNotes] = useState<ScannedNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    // Create and start the scanner
    const scanner = new ReceiverScanner(walletKeypair);
    
    // Listen for events
    const unsubscribe = scanner.on((event: ScannerEvent) => {
      if (event.type === 'balance_updated') {
        setBalance(event.balance);
        setIsLoading(false);
      }
      
      if (event.type === 'new_note') {
        setRecentNotes(prev => [event.note, ...prev].slice(0, 5));
        onFundsReceived?.(event.note.amount);
      }
    });
    
    // Start scanning
    scanner.start();
    
    // Get initial balance
    const initialBalance = scanner.getBalance();
    setBalance(initialBalance);
    setIsLoading(false);
    
    // Cleanup
    return () => {
      unsubscribe();
      scanner.stop();
    };
  }, [walletKeypair, onFundsReceived]);
  
  // Format balance for display
  const formatBalance = (lamports: bigint): string => {
    return (Number(lamports) / LAMPORTS_PER_SOL).toFixed(4);
  };
  
  // Format time ago
  const formatTimeAgo = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };
  
  return (
    <div className={`shielded-balance ${className}`}>
      {/* Balance Display */}
      <div className="balance-card">
        <div className="balance-label">Your Balance</div>
        <div className="balance-amount">
          {isLoading ? (
            <span className="loading-placeholder">Loading...</span>
          ) : (
            <>
              <span className="amount">
                {formatBalance(balance?.availableBalance || 0n)}
              </span>
              <span className="currency">SOL</span>
            </>
          )}
        </div>
        
        {/* Privacy indicator */}
        <div className="privacy-badge">
          <span className="shield-icon">🛡️</span>
          <span>Private</span>
        </div>
      </div>
      
      {/* Recent Activity */}
      {recentNotes.length > 0 && (
        <div className="recent-activity">
          <div className="activity-header">Recent Activity</div>
          <div className="activity-list">
            {recentNotes.map((note, index) => (
              <div key={index} className="activity-item">
                <div className="activity-icon">↓</div>
                <div className="activity-details">
                  <span className="activity-amount">
                    +{formatBalance(note.amount)} SOL
                  </span>
                  <span className="activity-time">
                    {formatTimeAgo(note.timestamp)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Optional Withdraw Button */}
      {showWithdraw && balance && balance.availableBalance > 0n && (
        <button className="withdraw-button">
          Convert to Public SOL
        </button>
      )}
      
      <style>{`
        .shielded-balance {
          max-width: 400px;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }
        
        .balance-card {
          padding: 32px;
          background: linear-gradient(135deg, #1a1a2e 0%, #16162a 100%);
          border-radius: 20px;
          text-align: center;
          border: 1px solid #2d2d5a;
        }
        
        .balance-label {
          font-size: 14px;
          color: #718096;
          margin-bottom: 8px;
        }
        
        .balance-amount {
          display: flex;
          align-items: baseline;
          justify-content: center;
          gap: 8px;
        }
        
        .balance-amount .amount {
          font-size: 48px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -2px;
        }
        
        .balance-amount .currency {
          font-size: 20px;
          font-weight: 500;
          color: #6366f1;
        }
        
        .loading-placeholder {
          font-size: 24px;
          color: #4a5568;
        }
        
        .privacy-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-top: 16px;
          padding: 6px 12px;
          background: rgba(34, 197, 94, 0.1);
          border-radius: 100px;
          font-size: 12px;
          color: #4ade80;
        }
        
        .shield-icon {
          font-size: 14px;
        }
        
        .recent-activity {
          margin-top: 24px;
          padding: 20px;
          background: #16162a;
          border-radius: 16px;
          border: 1px solid #2d2d5a;
        }
        
        .activity-header {
          font-size: 14px;
          font-weight: 600;
          color: #a0aec0;
          margin-bottom: 16px;
        }
        
        .activity-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .activity-item {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .activity-icon {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(34, 197, 94, 0.1);
          border-radius: 8px;
          color: #4ade80;
          font-weight: 600;
        }
        
        .activity-details {
          flex: 1;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .activity-amount {
          font-size: 14px;
          font-weight: 500;
          color: #4ade80;
        }
        
        .activity-time {
          font-size: 12px;
          color: #4a5568;
        }
        
        .withdraw-button {
          width: 100%;
          margin-top: 16px;
          padding: 12px;
          background: transparent;
          border: 1px solid #2d2d5a;
          border-radius: 12px;
          font-size: 14px;
          color: #a0aec0;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .withdraw-button:hover {
          border-color: #4a5568;
          color: #fff;
        }
      `}</style>
    </div>
  );
}

