/**
 * Private Send Form Component
 * 
 * A React component that provides the seamless UX for private sends.
 * 
 * The user only sees:
 * - Amount input (SOL)
 * - Receiver wallet address
 * - Send button
 * 
 * NO deposit, shield, withdraw, or pool terminology is exposed.
 * Everything happens automatically behind the scenes.
 */

import React, { useState, useCallback } from 'react';
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PrivateSendClient, PrivateSendResult } from '../client/PrivateSend.js';
import { RELAYER_FEE_LAMPORTS } from '../constants.js';

/**
 * Props for the PrivateSendForm component
 */
interface PrivateSendFormProps {
  /** The sender's wallet keypair */
  senderKeypair: Keypair;
  
  /** Optional: Custom styling */
  className?: string;
  
  /** Callback when send is successful */
  onSuccess?: (result: PrivateSendResult) => void;
  
  /** Callback when send fails */
  onError?: (error: string) => void;
}

/**
 * Form state
 */
interface FormState {
  amount: string;
  receiverAddress: string;
  isLoading: boolean;
  error: string | null;
  success: PrivateSendResult | null;
}

/**
 * Private Send Form
 * 
 * Clean, simple UI that hides all complexity.
 */
export function PrivateSendForm({
  senderKeypair,
  className = '',
  onSuccess,
  onError,
}: PrivateSendFormProps) {
  const [state, setState] = useState<FormState>({
    amount: '',
    receiverAddress: '',
    isLoading: false,
    error: null,
    success: null,
  });
  
  const client = new PrivateSendClient();
  
  // Calculate estimated cost
  const amountNum = parseFloat(state.amount) || 0;
  const estimate = client.estimateCost(amountNum);
  
  /**
   * Handle form submission
   */
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    setState(prev => ({ ...prev, isLoading: true, error: null, success: null }));
    
    try {
      const amountSol = parseFloat(state.amount);
      
      if (isNaN(amountSol) || amountSol <= 0) {
        throw new Error('Please enter a valid amount');
      }
      
      if (!state.receiverAddress.trim()) {
        throw new Error('Please enter a receiver address');
      }
      
      // Execute the private send
      const result = await client.send(
        senderKeypair,
        amountSol,
        state.receiverAddress.trim()
      );
      
      if (result.success) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          success: result,
          amount: '',
          receiverAddress: '',
        }));
        onSuccess?.(result);
      } else {
        throw new Error(result.error || 'Send failed');
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      onError?.(errorMessage);
    }
  }, [state.amount, state.receiverAddress, senderKeypair, client, onSuccess, onError]);
  
  return (
    <div className={`private-send-form ${className}`}>
      <form onSubmit={handleSubmit}>
        {/* Amount Input */}
        <div className="form-group">
          <label htmlFor="amount">Amount</label>
          <div className="input-wrapper">
            <input
              id="amount"
              type="number"
              step="0.001"
              min="0.01"
              max="100"
              placeholder="0.00"
              value={state.amount}
              onChange={(e) => setState(prev => ({ ...prev, amount: e.target.value }))}
              disabled={state.isLoading}
              required
            />
            <span className="input-suffix">SOL</span>
          </div>
        </div>
        
        {/* Receiver Address Input */}
        <div className="form-group">
          <label htmlFor="receiver">Receiver Wallet</label>
          <input
            id="receiver"
            type="text"
            placeholder="Enter Solana wallet address"
            value={state.receiverAddress}
            onChange={(e) => setState(prev => ({ ...prev, receiverAddress: e.target.value }))}
            disabled={state.isLoading}
            required
          />
        </div>
        
        {/* Cost Breakdown (subtle, non-intrusive) */}
        {amountNum > 0 && (
          <div className="cost-breakdown">
            <div className="cost-row">
              <span>Amount</span>
              <span>{estimate.amount.toFixed(4)} SOL</span>
            </div>
            <div className="cost-row fee">
              <span>Network fee</span>
              <span>{estimate.relayerFee.toFixed(4)} SOL</span>
            </div>
            <div className="cost-row total">
              <span>Total</span>
              <span>{estimate.total.toFixed(4)} SOL</span>
            </div>
          </div>
        )}
        
        {/* Error Message */}
        {state.error && (
          <div className="error-message">
            {state.error}
          </div>
        )}
        
        {/* Success Message */}
        {state.success && (
          <div className="success-message">
            <span className="check">✓</span>
            <span>Sent successfully!</span>
          </div>
        )}
        
        {/* Submit Button */}
        <button
          type="submit"
          disabled={state.isLoading || !state.amount || !state.receiverAddress}
          className="send-button"
        >
          {state.isLoading ? (
            <span className="loading">Sending...</span>
          ) : (
            <span>Send</span>
          )}
        </button>
      </form>
      
      {/* Privacy Note (subtle) */}
      <p className="privacy-note">
        Your transaction is private. The receiver will see the funds in their wallet.
      </p>
      
      <style>{`
        .private-send-form {
          max-width: 400px;
          padding: 24px;
          background: #1a1a2e;
          border-radius: 16px;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }
        
        .form-group {
          margin-bottom: 20px;
        }
        
        .form-group label {
          display: block;
          margin-bottom: 8px;
          font-size: 14px;
          font-weight: 500;
          color: #a0aec0;
        }
        
        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }
        
        .form-group input {
          width: 100%;
          padding: 14px 16px;
          background: #16162a;
          border: 1px solid #2d2d5a;
          border-radius: 12px;
          font-size: 16px;
          color: #fff;
          outline: none;
          transition: border-color 0.2s;
        }
        
        .form-group input:focus {
          border-color: #6366f1;
        }
        
        .form-group input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        .input-suffix {
          position: absolute;
          right: 16px;
          font-size: 14px;
          font-weight: 600;
          color: #6366f1;
        }
        
        .cost-breakdown {
          padding: 16px;
          background: #16162a;
          border-radius: 12px;
          margin-bottom: 20px;
        }
        
        .cost-row {
          display: flex;
          justify-content: space-between;
          font-size: 13px;
          color: #a0aec0;
          padding: 4px 0;
        }
        
        .cost-row.fee {
          color: #718096;
        }
        
        .cost-row.total {
          border-top: 1px solid #2d2d5a;
          margin-top: 8px;
          padding-top: 12px;
          font-weight: 600;
          color: #fff;
        }
        
        .error-message {
          padding: 12px 16px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 8px;
          color: #f87171;
          font-size: 14px;
          margin-bottom: 16px;
        }
        
        .success-message {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          background: rgba(34, 197, 94, 0.1);
          border: 1px solid rgba(34, 197, 94, 0.3);
          border-radius: 8px;
          color: #4ade80;
          font-size: 14px;
          margin-bottom: 16px;
        }
        
        .success-message .check {
          font-size: 18px;
        }
        
        .send-button {
          width: 100%;
          padding: 16px;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          border: none;
          border-radius: 12px;
          font-size: 16px;
          font-weight: 600;
          color: #fff;
          cursor: pointer;
          transition: opacity 0.2s, transform 0.1s;
        }
        
        .send-button:hover:not(:disabled) {
          opacity: 0.9;
        }
        
        .send-button:active:not(:disabled) {
          transform: scale(0.98);
        }
        
        .send-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .send-button .loading {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        
        .privacy-note {
          margin-top: 20px;
          text-align: center;
          font-size: 12px;
          color: #4a5568;
        }
        
        /* Number input hide arrows */
        input[type="number"]::-webkit-outer-spin-button,
        input[type="number"]::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        
        input[type="number"] {
          -moz-appearance: textfield;
        }
      `}</style>
    </div>
  );
}

/**
 * Minimal CSS-only version for non-React environments
 */
export const PRIVATE_SEND_FORM_HTML = `
<div class="private-send-form">
  <form id="private-send-form">
    <div class="form-group">
      <label for="amount">Amount</label>
      <div class="input-wrapper">
        <input id="amount" type="number" step="0.001" min="0.01" max="100" placeholder="0.00" required />
        <span class="input-suffix">SOL</span>
      </div>
    </div>
    
    <div class="form-group">
      <label for="receiver">Receiver Wallet</label>
      <input id="receiver" type="text" placeholder="Enter Solana wallet address" required />
    </div>
    
    <button type="submit" class="send-button">Send</button>
  </form>
  
  <p class="privacy-note">Your transaction is private.</p>
</div>
`;

