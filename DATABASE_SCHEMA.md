# Database Schema Reference

Generated: 2025-12-01T05:08:54.948Z

## Tables Overview

| Table | Rows | Size |
|-------|------|------|
| organisations | 1107 | 464 kB |
| spend_entries | 7226245 | 2996 MB |

## Table Columns

### organisations

| Column | Type | Nullable | Default |
|--------|------|----------|--------|
| id | integer | NO | nextval('organisations_id_seq'::regclass) |
| name | text | NO | - |
| trust_type | text | YES | - |
| ods_code | text | YES | - |
| post_code | text | YES | - |
| official_website | text | YES | - |
| spending_data_url | text | YES | - |
| missing_data_note | text | YES | - |
| verified_via | text | YES | - |
| created_at | timestamp with time zone | NO | now() |
| icb_ods_code | text | YES | - |
| latitude | double precision | YES | - |
| longitude | double precision | YES | - |

### spend_entries

| Column | Type | Nullable | Default |
|--------|------|----------|--------|
| id | integer | NO | nextval('spend_entries_id_seq'::regclass) |
| organisation_id | integer | NO | - |
| supplier | text | NO | - |
| amount | numeric | NO | - |
| payment_date | date | NO | - |
| raw_amount | text | YES | - |
| payment_date_raw | text | YES | - |
| source_file | text | NO | - |
| source_sheet | text | NO | - |
| source_row_number | integer | NO | - |
| created_at | timestamp with time zone | NO | now() |

## Indexes

- **organisations_name_unique** on `organisations`
  ```sql
  CREATE UNIQUE INDEX organisations_name_unique ON public.organisations USING btree (name)
  ```
- **organisations_ods_code_unique** on `organisations`
  ```sql
  CREATE UNIQUE INDEX organisations_ods_code_unique ON public.organisations USING btree (ods_code)
  ```
- **organisations_pkey** on `organisations`
  ```sql
  CREATE UNIQUE INDEX organisations_pkey ON public.organisations USING btree (id)
  ```
- **spend_entries_org_payment_idx** on `spend_entries`
  ```sql
  CREATE INDEX spend_entries_org_payment_idx ON public.spend_entries USING btree (organisation_id, payment_date)
  ```
- **spend_entries_pkey** on `spend_entries`
  ```sql
  CREATE UNIQUE INDEX spend_entries_pkey ON public.spend_entries USING btree (id)
  ```
- **spend_entries_source_row_unique** on `spend_entries`
  ```sql
  CREATE UNIQUE INDEX spend_entries_source_row_unique ON public.spend_entries USING btree (source_file, source_sheet, source_row_number)
  ```

## Foreign Keys

- `spend_entries.organisation_id` → `organisations.id`

## Sample Data

### organisations (sample)

```json
[
  {
    "id": 2582,
    "name": "NHS Derby & Derbyshire CCG",
    "trust_type": null,
    "ods_code": null,
    "post_code": null,
    "official_website": null,
    "spending_data_url": null,
    "missing_data_note": null,
    "verified_via": null,
    "created_at": "2025-11-13T08:34:29.250Z",
    "icb_ods_code": null,
    "latitude": null,
    "longitude": null
  },
  {
    "id": 2583,
    "name": "NHS Herefords &Worcs ICB",
    "trust_type": null,
    "ods_code": null,
    "post_code": null,
    "official_website": null,
    "spending_data_url": null,
    "missing_data_note": null,
    "verified_via": null,
    "created_at": "2025-11-13T08:34:29.250Z",
    "icb_ods_code": null,
    "latitude": null,
    "longitude": null
  },
  {
    "id": 2584,
    "name": "NHS Leicesterleicestershirerutland",
    "trust_type": null,
    "ods_code": null,
    "post_code": null,
    "official_website": null,
    "spending_data_url": null,
    "missing_data_note": null,
    "verified_via": null,
    "created_at": "2025-11-13T08:34:29.250Z",
    "icb_ods_code": null,
    "latitude": null,
    "longitude": null
  }
]
```

### spend_entries (sample)

```json
[
  {
    "id": 1565471,
    "organisation_id": 2460,
    "supplier": "STEAD C & PARTNERS",
    "amount": "19317.92",
    "payment_date": "2024-03-29T16:00:00.000Z",
    "raw_amount": "19317.92",
    "payment_date_raw": "2024-03-30T15:59:17.000Z",
    "source_file": "/Users/jeff/work/github/nhs-spend/data/1. NHS Integrated Care Board Spending (1-7).xlsx",
    "source_sheet": "NHS Mid and South Essex ICB",
    "source_row_number": 39232,
    "created_at": "2025-11-13T08:33:26.617Z"
  },
  {
    "id": 1565472,
    "organisation_id": 2460,
    "supplier": "STEAD C & PARTNERS",
    "amount": "241.50",
    "payment_date": "2024-03-29T16:00:00.000Z",
    "raw_amount": "241.5",
    "payment_date_raw": "2024-03-30T15:59:17.000Z",
    "source_file": "/Users/jeff/work/github/nhs-spend/data/1. NHS Integrated Care Board Spending (1-7).xlsx",
    "source_sheet": "NHS Mid and South Essex ICB",
    "source_row_number": 39233,
    "created_at": "2025-11-13T08:33:26.617Z"
  },
  {
    "id": 1565473,
    "organisation_id": 2460,
    "supplier": "STEAD C & PARTNERS",
    "amount": "9073.15",
    "payment_date": "2024-03-29T16:00:00.000Z",
    "raw_amount": "9073.15",
    "payment_date_raw": "2024-03-30T15:59:17.000Z",
    "source_file": "/Users/jeff/work/github/nhs-spend/data/1. NHS Integrated Care Board Spending (1-7).xlsx",
    "source_sheet": "NHS Mid and South Essex ICB",
    "source_row_number": 39234,
    "created_at": "2025-11-13T08:33:26.617Z"
  }
]
```
