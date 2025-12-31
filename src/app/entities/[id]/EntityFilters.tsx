"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface EntityFiltersProps {
  startDate: string;
  endDate: string;
}

export function EntityFilters({ startDate, endDate }: EntityFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setDatePreset = (preset: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", "1");
    
    switch (preset) {
      case "2024":
        params.set("startDate", "2024-01-01");
        params.set("endDate", "2024-12-31");
        break;
      case "2023":
        params.set("startDate", "2023-01-01");
        params.set("endDate", "2023-12-31");
        break;
      case "2022":
        params.set("startDate", "2022-01-01");
        params.set("endDate", "2022-12-31");
        break;
      case "all":
        params.delete("startDate");
        params.delete("endDate");
        break;
    }
    router.push(`?${params.toString()}`);
  };

  const onDateChange = (type: "startDate" | "endDate", value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", "1");
    if (value) {
      params.set(type, value);
    } else {
      params.delete(type);
    }
    router.push(`?${params.toString()}`);
  };

  return (
    <div style={styles.filtersContainer}>
      <div style={styles.dateRangeContainer}>
        <div style={styles.datePresets}>
          {["2024", "2023", "2022", "all"].map((preset) => (
            <button
              key={preset}
              style={{
                ...styles.presetButton,
                ...(preset === "all" 
                  ? (!startDate && !endDate ? styles.presetButtonActive : {})
                  : (startDate === `${preset}-01-01` && endDate === `${preset}-12-31` ? styles.presetButtonActive : {})
                ),
              }}
              onClick={() => setDatePreset(preset)}
            >
              {preset === "all" ? "All Time" : preset}
            </button>
          ))}
        </div>
        <div style={styles.dateInputs}>
          <input
            type="date"
            value={startDate}
            onChange={(e) => onDateChange("startDate", e.target.value)}
            style={styles.dateInput}
          />
          <span style={styles.dateSeparator}>to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => onDateChange("endDate", e.target.value)}
            style={styles.dateInput}
          />
        </div>
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  filtersContainer: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "12px",
    marginBottom: "24px",
  },
  dateRangeContainer: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    flexWrap: "wrap" as const,
  },
  datePresets: {
    display: "flex",
    gap: "4px",
  },
  presetButton: {
    padding: "8px 14px",
    border: "1px solid #e0e0e0",
    borderRadius: "6px",
    backgroundColor: "white",
    fontSize: "13px",
    fontWeight: 500,
    color: "#666",
    cursor: "pointer",
  },
  presetButtonActive: {
    backgroundColor: "#5c4d3c",
    color: "white",
    borderColor: "#5c4d3c",
  },
  dateInputs: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  dateInput: {
    padding: "8px 12px",
    border: "1px solid #e0e0e0",
    borderRadius: "6px",
    fontSize: "13px",
    backgroundColor: "white",
    color: "#333",
  },
  dateSeparator: {
    fontSize: "13px",
    color: "#888",
  },
};

