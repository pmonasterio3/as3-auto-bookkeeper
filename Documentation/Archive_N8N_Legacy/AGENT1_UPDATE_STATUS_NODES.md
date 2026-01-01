# Agent 1 - Update Status Nodes Configuration

**Last Updated:** December 29, 2025

---

## Update Status - Posted

Add these fields to save corrected dates/amounts:

### expense_date
```
={{ $json.corrected_expense_date || $('Edit Fields').first().json.date }}
```

### original_expense_date
```
={{ $json.original_expense_date }}
```

### amount
```
={{ $json.corrected_amount || $('Edit Fields').first().json.amount }}
```

### original_amount
```
={{ $json.original_amount }}
```

---

## Update Status - Flagged

Add these fields:

### expense_date
```
={{ $json.corrected_expense_date || $('Edit Fields').first().json.date }}
```

### original_expense_date
```
={{ $json.original_expense_date }}
```

---

## Why

Even when flagged, we should save the corrected date so:
1. The UI shows the correct date
2. Manual bank matching uses correct date
3. Audit trail preserved in original_expense_date
