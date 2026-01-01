-- Migration: Add original value columns for audit trail when AI auto-corrects values
-- Date: December 29, 2025
-- Purpose: Store original Zoho values when receipt validation auto-corrects amount or date

-- Add original_amount column to preserve the original Zoho amount before AI correction
ALTER TABLE zoho_expenses
ADD COLUMN IF NOT EXISTS original_amount DECIMAL(10,2);

-- Add original_expense_date column to preserve the original Zoho date before AI correction
-- This is critical for detecting DD/MM vs MM/DD date format inversions
ALTER TABLE zoho_expenses
ADD COLUMN IF NOT EXISTS original_expense_date DATE;

-- Add comment explaining these columns
COMMENT ON COLUMN zoho_expenses.original_amount IS 'Original amount from Zoho before AI auto-correction from receipt';
COMMENT ON COLUMN zoho_expenses.original_expense_date IS 'Original expense date from Zoho before AI auto-correction (handles DD/MM vs MM/DD format issues)';
