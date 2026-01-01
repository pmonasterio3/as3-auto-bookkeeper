/**
 * Database types for the AS3 Expense Automation System
 * Auto-generated from Supabase schema
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      bank_accounts: {
        Row: {
          account_key: string
          account_type: string
          bank_name: string
          created_at: string | null
          csv_format: string
          display_name: string
          id: string
          is_active: boolean | null
          last_four: string | null
          last_import_at: string | null
          last_import_count: number | null
          updated_at: string | null
        }
        Insert: {
          account_key: string
          account_type?: string
          bank_name: string
          created_at?: string | null
          csv_format: string
          display_name: string
          id?: string
          is_active?: boolean | null
          last_four?: string | null
          last_import_at?: string | null
          last_import_count?: number | null
          updated_at?: string | null
        }
        Update: {
          account_key?: string
          account_type?: string
          bank_name?: string
          created_at?: string | null
          csv_format?: string
          display_name?: string
          id?: string
          is_active?: boolean | null
          last_four?: string | null
          last_import_at?: string | null
          last_import_count?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      bank_transactions: {
        Row: {
          amount: number
          card_last_four: string | null
          created_at: string | null
          description: string
          description_normalized: string | null
          extracted_state: string | null
          extracted_vendor: string | null
          id: string
          import_batch_id: string | null
          match_confidence: number | null
          matched_at: string | null
          matched_by: string | null
          matched_expense_id: string | null
          monday_subitem_id: string | null
          orphan_category: string | null
          orphan_determination_method: string | null
          orphan_processed_at: string | null
          orphan_state: string | null
          post_date: string | null
          qbo_purchase_id: string | null
          reference_number: string | null
          source: string
          status: string
          transaction_date: string
          updated_at: string | null
          submitter_name: string | null
          submitter_email: string | null
          zoho_report_id: string | null
          zoho_report_number: string | null
        }
        Insert: {
          amount: number
          card_last_four?: string | null
          created_at?: string | null
          description: string
          description_normalized?: string | null
          extracted_state?: string | null
          extracted_vendor?: string | null
          id?: string
          import_batch_id?: string | null
          match_confidence?: number | null
          matched_at?: string | null
          matched_by?: string | null
          matched_expense_id?: string | null
          monday_subitem_id?: string | null
          orphan_category?: string | null
          orphan_determination_method?: string | null
          orphan_processed_at?: string | null
          orphan_state?: string | null
          post_date?: string | null
          qbo_purchase_id?: string | null
          reference_number?: string | null
          source: string
          status?: string
          transaction_date: string
          updated_at?: string | null
          submitter_name?: string | null
          submitter_email?: string | null
          zoho_report_id?: string | null
          zoho_report_number?: string | null
        }
        Update: {
          amount?: number
          card_last_four?: string | null
          created_at?: string | null
          description?: string
          description_normalized?: string | null
          extracted_state?: string | null
          extracted_vendor?: string | null
          id?: string
          import_batch_id?: string | null
          match_confidence?: number | null
          matched_at?: string | null
          matched_by?: string | null
          matched_expense_id?: string | null
          monday_subitem_id?: string | null
          orphan_category?: string | null
          orphan_determination_method?: string | null
          orphan_processed_at?: string | null
          orphan_state?: string | null
          post_date?: string | null
          qbo_purchase_id?: string | null
          reference_number?: string | null
          source?: string
          status?: string
          transaction_date?: string
          updated_at?: string | null
          submitter_name?: string | null
          submitter_email?: string | null
          zoho_report_id?: string | null
          zoho_report_number?: string | null
        }
        Relationships: []
      }
      categorization_history: {
        Row: {
          amount: number
          bank_transaction_id: string | null
          corrected_by: string | null
          created_at: string | null
          description: string | null
          final_category: string | null
          final_state: string | null
          id: string
          monday_event_id: string | null
          monday_event_name: string | null
          predicted_category: string | null
          predicted_confidence: number | null
          predicted_state: string | null
          qbo_transaction_id: string | null
          receipt_amount: number | null
          receipt_validated: boolean | null
          source: string
          transaction_date: string
          vendor_clean: string | null
          vendor_raw: string | null
          venue_name: string | null
          venue_state: string | null
          was_corrected: boolean | null
          zoho_expense_id: string | null
        }
        Insert: {
          amount: number
          bank_transaction_id?: string | null
          corrected_by?: string | null
          created_at?: string | null
          description?: string | null
          final_category?: string | null
          final_state?: string | null
          id?: string
          monday_event_id?: string | null
          monday_event_name?: string | null
          predicted_category?: string | null
          predicted_confidence?: number | null
          predicted_state?: string | null
          qbo_transaction_id?: string | null
          receipt_amount?: number | null
          receipt_validated?: boolean | null
          source: string
          transaction_date: string
          vendor_clean?: string | null
          vendor_raw?: string | null
          venue_name?: string | null
          venue_state?: string | null
          was_corrected?: boolean | null
          zoho_expense_id?: string | null
        }
        Update: {
          amount?: number
          bank_transaction_id?: string | null
          corrected_by?: string | null
          created_at?: string | null
          description?: string | null
          final_category?: string | null
          final_state?: string | null
          id?: string
          monday_event_id?: string | null
          monday_event_name?: string | null
          predicted_category?: string | null
          predicted_confidence?: number | null
          predicted_state?: string | null
          qbo_transaction_id?: string | null
          receipt_amount?: number | null
          receipt_validated?: boolean | null
          source?: string
          transaction_date?: string
          vendor_clean?: string | null
          vendor_raw?: string | null
          venue_name?: string | null
          venue_state?: string | null
          was_corrected?: boolean | null
          zoho_expense_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_cat_history_bank_transaction"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_queue: {
        Row: {
          alternate_bank_txn_ids: string[] | null
          amount: number
          category_name: string | null
          category_suggested: string | null
          confidence_score: number | null
          corrections: Json | null
          created_at: string | null
          expense_date: string
          flag_reason: string | null
          id: string
          is_reimbursement: boolean | null
          original_data: Json | null
          paid_through: string | null
          processing_result: Json | null
          qbo_bill_id: string | null
          qbo_purchase_id: string | null
          qbo_vendor_id: string | null
          receipt_url: string | null
          reimbursed_at: string | null
          reimbursed_by: string | null
          reimbursement_method: string | null
          reimbursement_reference: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          state_suggested: string | null
          status: string
          suggested_bank_txn_id: string | null
          updated_at: string | null
          vendor_name: string
          zoho_expense_id: string
          zoho_report_id: string | null
          zoho_report_name: string | null
        }
        Insert: {
          alternate_bank_txn_ids?: string[] | null
          amount: number
          category_name?: string | null
          category_suggested?: string | null
          confidence_score?: number | null
          corrections?: Json | null
          created_at?: string | null
          expense_date: string
          flag_reason?: string | null
          id?: string
          is_reimbursement?: boolean | null
          original_data?: Json | null
          paid_through?: string | null
          processing_result?: Json | null
          qbo_bill_id?: string | null
          qbo_purchase_id?: string | null
          qbo_vendor_id?: string | null
          receipt_url?: string | null
          reimbursed_at?: string | null
          reimbursed_by?: string | null
          reimbursement_method?: string | null
          reimbursement_reference?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state_suggested?: string | null
          status?: string
          suggested_bank_txn_id?: string | null
          updated_at?: string | null
          vendor_name: string
          zoho_expense_id: string
          zoho_report_id?: string | null
          zoho_report_name?: string | null
        }
        Update: {
          alternate_bank_txn_ids?: string[] | null
          amount?: number
          category_name?: string | null
          category_suggested?: string | null
          confidence_score?: number | null
          corrections?: Json | null
          created_at?: string | null
          expense_date?: string
          flag_reason?: string | null
          id?: string
          is_reimbursement?: boolean | null
          original_data?: Json | null
          paid_through?: string | null
          processing_result?: Json | null
          qbo_bill_id?: string | null
          qbo_purchase_id?: string | null
          qbo_vendor_id?: string | null
          receipt_url?: string | null
          reimbursed_at?: string | null
          reimbursed_by?: string | null
          reimbursement_method?: string | null
          reimbursement_reference?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state_suggested?: string | null
          status?: string
          suggested_bank_txn_id?: string | null
          updated_at?: string | null
          vendor_name?: string
          zoho_expense_id?: string
          zoho_report_id?: string | null
          zoho_report_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_queue_suggested_bank_txn_id_fkey"
            columns: ["suggested_bank_txn_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      flagged_expenses: {
        Row: {
          amount: number
          bank_transaction_id: string | null
          created_at: string | null
          description: string | null
          flag_reason: string
          id: string
          predicted_category: string | null
          predicted_confidence: number | null
          predicted_state: string | null
          qbo_transaction_id: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_category: string | null
          resolved_state: string | null
          source: string
          status: string | null
          teams_message_id: string | null
          transaction_date: string
          vendor_raw: string | null
          zoho_expense_id: string | null
          zoho_report_id: string | null
        }
        Insert: {
          amount: number
          bank_transaction_id?: string | null
          created_at?: string | null
          description?: string | null
          flag_reason: string
          id?: string
          predicted_category?: string | null
          predicted_confidence?: number | null
          predicted_state?: string | null
          qbo_transaction_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_category?: string | null
          resolved_state?: string | null
          source: string
          status?: string | null
          teams_message_id?: string | null
          transaction_date: string
          vendor_raw?: string | null
          zoho_expense_id?: string | null
          zoho_report_id?: string | null
        }
        Update: {
          amount?: number
          bank_transaction_id?: string | null
          created_at?: string | null
          description?: string | null
          flag_reason?: string
          id?: string
          predicted_category?: string | null
          predicted_confidence?: number | null
          predicted_state?: string | null
          qbo_transaction_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_category?: string | null
          resolved_state?: string | null
          source?: string
          status?: string | null
          teams_message_id?: string | null
          transaction_date?: string
          vendor_raw?: string | null
          zoho_expense_id?: string | null
          zoho_report_id?: string | null
        }
        Relationships: []
      }
      monday_events: {
        Row: {
          board_id: string
          client_name: string | null
          course_type: string | null
          created_at: string | null
          end_date: string | null
          event_name: string
          expense_count: number | null
          group_id: string | null
          id: string
          is_open_enrollment: boolean | null
          last_synced_at: string | null
          monday_item_id: string
          start_date: string
          state: string | null
          total_expenses: number | null
          updated_at: string | null
          venue: string | null
          venue_code: string | null
        }
        Insert: {
          board_id: string
          client_name?: string | null
          course_type?: string | null
          created_at?: string | null
          end_date?: string | null
          event_name: string
          expense_count?: number | null
          group_id?: string | null
          id?: string
          is_open_enrollment?: boolean | null
          last_synced_at?: string | null
          monday_item_id: string
          start_date: string
          state?: string | null
          total_expenses?: number | null
          updated_at?: string | null
          venue?: string | null
          venue_code?: string | null
        }
        Update: {
          board_id?: string
          client_name?: string | null
          course_type?: string | null
          created_at?: string | null
          end_date?: string | null
          event_name?: string
          expense_count?: number | null
          group_id?: string | null
          id?: string
          is_open_enrollment?: boolean | null
          last_synced_at?: string | null
          monday_item_id?: string
          start_date?: string
          state?: string | null
          total_expenses?: number | null
          updated_at?: string | null
          venue?: string | null
          venue_code?: string | null
        }
        Relationships: []
      }
      qbo_accounts: {
        Row: {
          account_type: string
          created_at: string | null
          id: string
          is_cogs: boolean | null
          is_payment_account: boolean | null
          name: string
          qbo_id: string
          times_used: number | null
          zoho_category_match: string | null
        }
        Insert: {
          account_type: string
          created_at?: string | null
          id?: string
          is_cogs?: boolean | null
          is_payment_account?: boolean | null
          name: string
          qbo_id: string
          times_used?: number | null
          zoho_category_match?: string | null
        }
        Update: {
          account_type?: string
          created_at?: string | null
          id?: string
          is_cogs?: boolean | null
          is_payment_account?: boolean | null
          name?: string
          qbo_id?: string
          times_used?: number | null
          zoho_category_match?: string | null
        }
        Relationships: []
      }
      qbo_classes: {
        Row: {
          id: string
          qbo_class_id: string
          state_code: string
          class_name: string
          created_at: string | null
        }
        Insert: {
          id?: string
          qbo_class_id: string
          state_code: string
          class_name: string
          created_at?: string | null
        }
        Update: {
          id?: string
          qbo_class_id?: string
          state_code?: string
          class_name?: string
          created_at?: string | null
        }
        Relationships: []
      }
      vendor_rules: {
        Row: {
          id: string
          vendor_pattern: string
          vendor_name_clean: string | null
          default_category: string | null
          default_state: string | null
          is_cogs: boolean | null
          confidence: number | null
          times_used: number | null
          match_count: number | null
          last_matched_at: string | null
          notes: string | null
          created_by: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          vendor_pattern: string
          vendor_name_clean?: string | null
          default_category?: string | null
          default_state?: string | null
          is_cogs?: boolean | null
          confidence?: number | null
          times_used?: number | null
          match_count?: number | null
          last_matched_at?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          vendor_pattern?: string
          vendor_name_clean?: string | null
          default_category?: string | null
          default_state?: string | null
          is_cogs?: boolean | null
          confidence?: number | null
          times_used?: number | null
          match_count?: number | null
          last_matched_at?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      processing_errors: {
        Row: {
          id: string
          expense_id: string | null
          zoho_report_id: string | null
          error_node: string
          error_message: string | null
          error_details: Json | null
          raw_payload: Json | null
          status: string
          retry_count: number | null
          created_at: string | null
          resolved_at: string | null
          resolved_by: string | null
          notes: string | null
        }
        Insert: {
          id?: string
          expense_id?: string | null
          zoho_report_id?: string | null
          error_node: string
          error_message?: string | null
          error_details?: Json | null
          raw_payload?: Json | null
          status?: string
          retry_count?: number | null
          created_at?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          notes?: string | null
        }
        Update: {
          id?: string
          expense_id?: string | null
          zoho_report_id?: string | null
          error_node?: string
          error_message?: string | null
          error_details?: Json | null
          raw_payload?: Json | null
          status?: string
          retry_count?: number | null
          created_at?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          notes?: string | null
        }
        Relationships: []
      }
      zoho_expenses: {
        Row: {
          id: string
          zoho_expense_id: string
          zoho_report_id: string
          expense_date: string | null
          amount: number | null
          vendor_name: string | null
          category_name: string | null
          description: string | null
          created_at: string | null
          updated_at: string | null
          // Queue columns (v3.0 architecture)
          zoho_report_name: string | null
          raw_payload: Json | null
          merchant_name: string | null
          state_tag: string | null
          paid_through: string | null
          receipt_storage_path: string | null
          receipt_content_type: string | null
          status: string | null
          processing_attempts: number | null
          processing_started_at: string | null
          last_error: string | null
          bank_transaction_id: string | null
          match_confidence: number | null
          qbo_purchase_id: string | null
          qbo_posted_at: string | null
          processed_at: string | null
        }
        Insert: {
          id?: string
          zoho_expense_id: string
          zoho_report_id: string
          expense_date?: string | null
          amount?: number | null
          vendor_name?: string | null
          category_name?: string | null
          description?: string | null
          created_at?: string | null
          updated_at?: string | null
          // Queue columns (v3.0 architecture)
          zoho_report_name?: string | null
          raw_payload?: Json | null
          merchant_name?: string | null
          state_tag?: string | null
          paid_through?: string | null
          receipt_storage_path?: string | null
          receipt_content_type?: string | null
          status?: string | null
          processing_attempts?: number | null
          processing_started_at?: string | null
          last_error?: string | null
          bank_transaction_id?: string | null
          match_confidence?: number | null
          qbo_purchase_id?: string | null
          qbo_posted_at?: string | null
          processed_at?: string | null
        }
        Update: {
          id?: string
          zoho_expense_id?: string
          zoho_report_id?: string
          expense_date?: string | null
          amount?: number | null
          vendor_name?: string | null
          category_name?: string | null
          description?: string | null
          created_at?: string | null
          updated_at?: string | null
          // Queue columns (v3.0 architecture)
          zoho_report_name?: string | null
          raw_payload?: Json | null
          merchant_name?: string | null
          state_tag?: string | null
          paid_through?: string | null
          receipt_storage_path?: string | null
          receipt_content_type?: string | null
          status?: string | null
          processing_attempts?: number | null
          processing_started_at?: string | null
          last_error?: string | null
          bank_transaction_id?: string | null
          match_confidence?: number | null
          qbo_purchase_id?: string | null
          qbo_posted_at?: string | null
          processed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_zoho_expenses_report"
            columns: ["zoho_report_id"]
            isOneToOne: false
            referencedRelation: "zoho_expense_reports"
            referencedColumns: ["zoho_report_id"]
          },
          {
            foreignKeyName: "fk_zoho_expenses_bank_transaction"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          }
        ]
      }
      zoho_expense_reports: {
        Row: {
          id: string
          zoho_report_id: string
          report_number: string | null
          report_name: string | null
          submitter_name: string | null
          submitter_email: string | null
          submitter_user_id: string | null
          submitted_at: string | null
          approver_name: string | null
          approver_email: string | null
          approver_user_id: string | null
          approved_at: string | null
          expense_count: number | null
          total_amount: number | null
          report_status: string | null
          approval_path: unknown | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          zoho_report_id: string
          report_number?: string | null
          report_name?: string | null
          submitter_name?: string | null
          submitter_email?: string | null
          submitter_user_id?: string | null
          submitted_at?: string | null
          approver_name?: string | null
          approver_email?: string | null
          approver_user_id?: string | null
          approved_at?: string | null
          expense_count?: number | null
          total_amount?: number | null
          report_status?: string | null
          approval_path?: unknown | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          zoho_report_id?: string
          report_number?: string | null
          report_name?: string | null
          submitter_name?: string | null
          submitter_email?: string | null
          submitter_user_id?: string | null
          submitted_at?: string | null
          approver_name?: string | null
          approver_email?: string | null
          approver_user_id?: string | null
          approved_at?: string | null
          expense_count?: number | null
          total_amount?: number | null
          report_status?: string | null
          approval_path?: unknown | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          id: string
          email: string
          full_name: string
          role: 'admin' | 'bookkeeper' | 'submitter'
          linked_zoho_emails: string[]
          is_active: boolean
          invited_by: string | null
          invited_at: string | null
          last_login_at: string | null
          org_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name: string
          role?: 'admin' | 'bookkeeper' | 'submitter'
          linked_zoho_emails?: string[]
          is_active?: boolean
          invited_by?: string | null
          invited_at?: string | null
          last_login_at?: string | null
          org_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string
          role?: 'admin' | 'bookkeeper' | 'submitter'
          linked_zoho_emails?: string[]
          is_active?: boolean
          invited_by?: string | null
          invited_at?: string | null
          last_login_at?: string | null
          org_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      external_identity_links: {
        Row: {
          id: string
          user_id: string
          provider: string
          external_id: string
          external_email: string | null
          external_name: string | null
          metadata: Json
          is_primary: boolean
          linked_at: string
          linked_by: string | null
        }
        Insert: {
          id?: string
          user_id: string
          provider: string
          external_id: string
          external_email?: string | null
          external_name?: string | null
          metadata?: Json
          is_primary?: boolean
          linked_at?: string
          linked_by?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          provider?: string
          external_id?: string
          external_email?: string | null
          external_name?: string | null
          metadata?: Json
          is_primary?: boolean
          linked_at?: string
          linked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_identity_links_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      user_invitations: {
        Row: {
          id: string
          email: string
          full_name: string
          role: 'admin' | 'bookkeeper' | 'submitter'
          token: string
          invited_by: string
          invited_at: string
          expires_at: string
          accepted_at: string | null
          user_id: string | null
          status: 'pending' | 'accepted' | 'expired' | 'revoked'
        }
        Insert: {
          id?: string
          email: string
          full_name: string
          role: 'admin' | 'bookkeeper' | 'submitter'
          token?: string
          invited_by: string
          invited_at?: string
          expires_at?: string
          accepted_at?: string | null
          user_id?: string | null
          status?: 'pending' | 'accepted' | 'expired' | 'revoked'
        }
        Update: {
          id?: string
          email?: string
          full_name?: string
          role?: 'admin' | 'bookkeeper' | 'submitter'
          token?: string
          invited_by?: string
          invited_at?: string
          expires_at?: string
          accepted_at?: string | null
          user_id?: string | null
          status?: 'pending' | 'accepted' | 'expired' | 'revoked'
        }
        Relationships: []
      }
    }
    Views: {
      dashboard_stats: {
        Row: {
          amount_this_week: number | null
          amount_today: number | null
          corrections_this_week: number | null
          orphan_bank_txns: number | null
          pending_reimbursements: number | null
          pending_reviews: number | null
          processed_today: number | null
          unmatched_bank_txns: number | null
        }
        Relationships: []
      }
      expenses_by_state: {
        Row: {
          expense_count: number | null
          month: string | null
          state: string | null
          total_amount: number | null
        }
        Relationships: []
      }
    }
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

// Convenience types for table rows
export type BankAccount = Database['public']['Tables']['bank_accounts']['Row']
export type BankAccountInsert = Database['public']['Tables']['bank_accounts']['Insert']
export type BankAccountUpdate = Database['public']['Tables']['bank_accounts']['Update']

export type BankTransaction = Database['public']['Tables']['bank_transactions']['Row']
export type BankTransactionInsert = Database['public']['Tables']['bank_transactions']['Insert']
export type BankTransactionUpdate = Database['public']['Tables']['bank_transactions']['Update']

export type ExpenseQueueItem = Database['public']['Tables']['expense_queue']['Row']
export type ExpenseQueueInsert = Database['public']['Tables']['expense_queue']['Insert']
export type ExpenseQueueUpdate = Database['public']['Tables']['expense_queue']['Update']

export type MondayEvent = Database['public']['Tables']['monday_events']['Row']
export type CategorizationHistory = Database['public']['Tables']['categorization_history']['Row']
export type VendorRule = Database['public']['Tables']['vendor_rules']['Row']
export type QBOAccount = Database['public']['Tables']['qbo_accounts']['Row']
export type FlaggedExpense = Database['public']['Tables']['flagged_expenses']['Row']

// Zoho expenses (queue-based architecture v3.0)
export type ZohoExpense = Database['public']['Tables']['zoho_expenses']['Row']
export type ZohoExpenseInsert = Database['public']['Tables']['zoho_expenses']['Insert']
export type ZohoExpenseUpdate = Database['public']['Tables']['zoho_expenses']['Update']

// View types
export type DashboardStats = Database['public']['Views']['dashboard_stats']['Row']
export type ExpensesByState = Database['public']['Views']['expenses_by_state']['Row']

// Zoho expense report details (for joined queries)
export interface ZohoExpenseReport {
  zoho_report_id: string
  report_number: string | null
  report_name: string | null
  submitter_name: string | null
  submitter_email: string | null
  submitted_at: string | null
  approver_name: string | null
  approver_email: string | null
  approved_at: string | null
  expense_count: number | null
  total_amount: number | null
  report_status: string | null
}

// Extended bank transaction with joined report data
export interface BankTransactionWithReport extends BankTransaction {
  zoho_expense_reports?: ZohoExpenseReport | null
}

// Processing errors convenience type
export type ProcessingError = Database['public']['Tables']['processing_errors']['Row']

// QBO Classes
export type QboClass = Database['public']['Tables']['qbo_classes']['Row']

// Alias for consistency (also exported as QBOAccount)
export type QboAccount = Database['public']['Tables']['qbo_accounts']['Row']

// User Management types
export type UserRole = 'admin' | 'bookkeeper' | 'submitter'
export type UserProfile = Database['public']['Tables']['user_profiles']['Row']
export type UserProfileInsert = Database['public']['Tables']['user_profiles']['Insert']
export type UserProfileUpdate = Database['public']['Tables']['user_profiles']['Update']

export type ExternalIdentityLink = Database['public']['Tables']['external_identity_links']['Row']
export type ExternalIdentityLinkInsert = Database['public']['Tables']['external_identity_links']['Insert']
export type ExternalIdentityLinkUpdate = Database['public']['Tables']['external_identity_links']['Update']

export type UserInvitation = Database['public']['Tables']['user_invitations']['Row']
export type UserInvitationInsert = Database['public']['Tables']['user_invitations']['Insert']
export type UserInvitationUpdate = Database['public']['Tables']['user_invitations']['Update']
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked'
