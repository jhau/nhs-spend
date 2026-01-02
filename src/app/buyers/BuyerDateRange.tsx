"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { getDefaultDateRange } from "@/lib/utils";

export function BuyerDateRange() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const defaultDates = getDefaultDateRange();
  const startDate = searchParams.get("startDate") ?? defaultDates.startDate;
  const endDate = searchParams.get("endDate") ?? defaultDates.endDate;

  const updateDateRange = (start: string, end: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (start) params.set("startDate", start);
    else params.delete("startDate");
    if (end) params.set("endDate", end);
    else params.delete("endDate");
    params.set("page", "1");
    router.push(`?${params.toString()}`);
  };

  const setDatePreset = (preset: string) => {
    switch (preset) {
      case "2024":
        updateDateRange("2024-01-01", "2024-12-31");
        break;
      case "2023":
        updateDateRange("2023-01-01", "2023-12-31");
        break;
      case "2022":
        updateDateRange("2022-01-01", "2022-12-31");
        break;
      case "all":
        updateDateRange("", "");
        break;
    }
  };

  return (
    <div style={styles.dateRangeContainer}>
      <div style={styles.datePresets}>
        <button
          style={{
            ...styles.presetButton,
            ...(startDate === "2024-01-01" && endDate === "2024-12-31" ? styles.presetButtonActive : {}),
          }}
          onClick={() => setDatePreset("2024")}
        >
          2024
        </button>
        <button
          style={{
            ...styles.presetButton,
            ...(startDate === "2023-01-01" && endDate === "2023-12-31" ? styles.presetButtonActive : {}),
          }}
          onClick={() => setDatePreset("2023")}
        >
          2023
        </button>
        <button
          style={{
            ...styles.presetButton,
            ...(startDate === "2022-01-01" && endDate === "2022-12-31" ? styles.presetButtonActive : {}),
          }}
          onClick={() => setDatePreset("2022")}
        >
          2022
        </button>
        <button
          style={{
            ...styles.presetButton,
            ...(!startDate && !endDate ? styles.presetButtonActive : {}),
          }}
          onClick={() => setDatePreset("all")}
        >
          All Time
        </button>
      </div>
      <div style={styles.dateInputs}>
        <input
          type="date"
          value={startDate}
          onChange={(e) => updateDateRange(e.target.value, endDate)}
          style={styles.dateInput}
        />
        <span style={styles.dateSeparator}>to</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => updateDateRange(startDate, e.target.value)}
          style={styles.dateInput}
        />
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  dateRangeContainer: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
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

