"use client";

import { useEffect, useState, useCallback } from "react";
import { ComposableMap, Geographies, Geography, ZoomableGroup } from "react-simple-maps";

interface Region {
  name: string;
  totalSpend: number;
  buyers: number;
  spendLevel: "low" | "medium" | "high";
  topBuyers: Array<{ id: number; name: string; spend: number; supplierCount: number }>;
}

interface TooltipData {
  name: string;
  totalSpend: number;
  buyers: number;
  x: number;
  y: number;
}

interface Props {
  startDate: string;
  endDate: string;
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `£${(amount / 1_000_000_000).toFixed(2)}B`;
  }
  if (amount >= 1_000_000) {
    return `£${(amount / 1_000_000).toFixed(0)}M`;
  }
  if (amount >= 1_000) {
    return `£${(amount / 1_000).toFixed(0)}K`;
  }
  return `£${amount.toFixed(0)}`;
}

// Map GeoJSON region names to our data region names
const GEO_TO_DATA_REGION: Record<string, string> = {
  "North East": "North East",
  "North West": "North West",
  "Yorkshire and The Humber": "Yorkshire",
  "East Midlands": "Midlands",
  "West Midlands": "Midlands",
  "East of England": "East of England",
  "London": "London",
  "South East": "South East",
  "South West": "South West",
  "Wales": "Wales",
  "Scotland": "Scotland",
  "Northern Ireland": "Northern Ireland",
};

// Map centers and zoom levels for each region
const REGION_MAP_CONFIG: Record<string, { center: [number, number]; scale: number }> = {
  "North East": { center: [-1.5, 55.0], scale: 12000 },
  "North West": { center: [-2.5, 54.0], scale: 8000 },
  "Yorkshire": { center: [-1.2, 53.8], scale: 8000 },
  "Midlands": { center: [-1.8, 52.5], scale: 7000 },
  "East of England": { center: [0.5, 52.2], scale: 7000 },
  "London": { center: [-0.1, 51.5], scale: 25000 },
  "South East": { center: [-0.5, 51.2], scale: 6000 },
  "South West": { center: [-3.5, 50.8], scale: 5500 },
  "Wales": { center: [-3.5, 52.0], scale: 6000 },
  "Scotland": { center: [-4.0, 56.5], scale: 3500 },
  "Northern Ireland": { center: [-7.0, 54.6], scale: 10000 },
  "Other": { center: [-3, 55.5], scale: 2200 },
};

// Get data region name from GeoJSON region name
function getDataRegionName(geoName: string): string {
  return GEO_TO_DATA_REGION[geoName] || "Other";
}

// Check if a GeoJSON region belongs to the selected data region
function geoMatchesRegion(geoName: string, selectedRegion: string): boolean {
  const dataRegion = GEO_TO_DATA_REGION[geoName];
  return dataRegion === selectedRegion;
}

export default function RegionalActivity({ startDate, endDate }: Props) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const fetchRegions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      });
      const res = await fetch(`/api/regions?${params}`);
      if (!res.ok) throw new Error("Failed to fetch data");
      const data = await res.json();
      setRegions(data.regions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchRegions();
  }, [fetchRegions]);

  const handleRegionClick = (region: string) => {
    if (region !== "Other") {
      setSelectedRegion(region);
    }
  };

  const handleBackClick = () => {
    setSelectedRegion(null);
  };

  const getRegionColor = (regionName: string, isDetailView: boolean = false) => {
    const region = regions.find((r) => r.name === regionName);
    if (!region) return "#e5e5e5";
    
    if (isDetailView) {
      // In detail view, use a highlighted color
      return "#3b82f6";
    }
    
    switch (region.spendLevel) {
      case "high":
        return "#22c55e";
      case "medium":
        return "#eab308";
      case "low":
        return "#d1d5db";
      default:
        return "#e5e5e5";
    }
  };

  const handleMouseEnter = (regionName: string, event: React.MouseEvent) => {
    const region = regions.find((r) => r.name === regionName);
    if (region) {
      setTooltip({
        name: region.name,
        totalSpend: region.totalSpend,
        buyers: region.buyers,
        x: event.clientX,
        y: event.clientY,
      });
    }
  };

  const handleMouseMove = (event: React.MouseEvent) => {
    if (tooltip) {
      setTooltip((prev) => prev ? { ...prev, x: event.clientX, y: event.clientY } : null);
    }
  };

  const handleMouseLeave = () => {
    setTooltip(null);
  };

  // Get selected region data
  const selectedRegionData = selectedRegion 
    ? regions.find((r) => r.name === selectedRegion) 
    : null;

  // Get map configuration
  const mapConfig = selectedRegion 
    ? REGION_MAP_CONFIG[selectedRegion] || REGION_MAP_CONFIG["Other"]
    : { center: [-3, 55.5] as [number, number], scale: 2200 };

  return (
    <div style={styles.container}>
      {/* Header with back button */}
      <div style={styles.header}>
        {selectedRegion ? (
          <button style={styles.backButton} onClick={handleBackClick}>
            ← Back to UK Overview
          </button>
        ) : (
          <div />
        )}
        <div style={styles.legend}>
          <span style={styles.legendItem}>
            <span style={{ ...styles.legendDot, backgroundColor: "#d1d5db" }} /> Low spend
          </span>
          <span style={styles.legendItem}>
            <span style={{ ...styles.legendDot, backgroundColor: "#eab308" }} /> Medium spend
          </span>
          <span style={styles.legendItem}>
            <span style={{ ...styles.legendDot, backgroundColor: "#22c55e" }} /> High spend
          </span>
        </div>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {/* Region Title when drilled down */}
      {selectedRegion && selectedRegionData && (
        <div style={styles.regionHeader}>
          <h2 style={styles.regionTitle}>{selectedRegion}</h2>
          <div style={styles.regionStats}>
            <div style={styles.regionStat}>
              <span style={styles.regionStatValue}>{formatCurrency(selectedRegionData.totalSpend)}</span>
              <span style={styles.regionStatLabel}>Total Spend</span>
            </div>
            <div style={styles.regionStat}>
              <span style={styles.regionStatValue}>{selectedRegionData.buyers}</span>
              <span style={styles.regionStatLabel}>Organisations</span>
            </div>
            <div style={styles.regionStat}>
              <span style={{
                ...styles.spendBadge,
                backgroundColor: selectedRegionData.spendLevel === "high" ? "#dcfce7" : selectedRegionData.spendLevel === "medium" ? "#fef3c7" : "#f3f4f6",
                color: selectedRegionData.spendLevel === "high" ? "#166534" : selectedRegionData.spendLevel === "medium" ? "#92400e" : "#374151",
              }}>
                {selectedRegionData.spendLevel.charAt(0).toUpperCase() + selectedRegionData.spendLevel.slice(1)} Spend Region
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Map Section */}
      <div style={styles.mapSection}>
        {loading ? (
          <div style={styles.loading}>Loading map...</div>
        ) : (
          <ComposableMap
            projection="geoMercator"
            projectionConfig={{
              center: mapConfig.center,
              scale: mapConfig.scale,
            }}
            style={{ width: "100%", height: "100%" }}
          >
            <ZoomableGroup center={mapConfig.center} zoom={1}>
              <Geographies geography="/uk-regions.json">
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const geoName = geo.properties.name || geo.properties.RGN22NM || geo.properties.CTRY22NM || "";
                    const dataRegionName = getDataRegionName(geoName);
                    
                    // In detail view, only show the selected region
                    if (selectedRegion) {
                      const matches = geoMatchesRegion(geoName, selectedRegion);
                      if (!matches) {
                        return (
                          <Geography
                            key={geo.rsmKey}
                            geography={geo}
                            fill="#f0f0f0"
                            stroke="#e0e0e0"
                            strokeWidth={0.3}
                            style={{
                              default: { outline: "none" },
                              hover: { outline: "none" },
                              pressed: { outline: "none" },
                            }}
                          />
                        );
                      }
                    }
                    
                    const fillColor = selectedRegion 
                      ? getRegionColor(dataRegionName, true)
                      : getRegionColor(dataRegionName);
                    
                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={fillColor}
                        stroke="#fff"
                        strokeWidth={selectedRegion ? 1 : 0.5}
                        style={{
                          default: { outline: "none" },
                          hover: { fill: selectedRegion ? "#2563eb" : "#3b82f6", outline: "none", cursor: "pointer" },
                          pressed: { fill: "#1d4ed8", outline: "none" },
                        }}
                        onClick={() => !selectedRegion && handleRegionClick(dataRegionName)}
                        onMouseEnter={(e) => !selectedRegion && handleMouseEnter(dataRegionName, e)}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                      />
                    );
                  })
                }
              </Geographies>
            </ZoomableGroup>
          </ComposableMap>
        )}
      </div>

      {/* Tooltip */}
      {tooltip && !selectedRegion && (
        <div
          style={{
            ...styles.tooltip,
            left: Math.min(tooltip.x + 15, typeof window !== 'undefined' ? window.innerWidth - 200 : tooltip.x + 15),
            top: Math.max(tooltip.y - 80, 10),
          }}
        >
          <div style={styles.tooltipTitle}>{tooltip.name}</div>
          <div style={styles.tooltipRow}>
            <span style={styles.tooltipLabel}>Total Spend:</span>
            <span style={styles.tooltipValue}>{formatCurrency(tooltip.totalSpend)}</span>
          </div>
          <div style={styles.tooltipRow}>
            <span style={styles.tooltipLabel}>Buyers:</span>
            <span style={styles.tooltipValue}>{tooltip.buyers}</span>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>{selectedRegion ? "Organisation" : "Region"}</th>
              <th style={{ ...styles.th, textAlign: "right" }}>Total Spend</th>
              <th style={{ ...styles.th, textAlign: "center" }}>{selectedRegion ? "Suppliers" : "Buyers"}</th>
              <th style={styles.th}>{selectedRegion ? "Type" : "Top Organisation"}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} style={styles.loadingCell}>Loading...</td>
              </tr>
            ) : selectedRegion && selectedRegionData ? (
              // Show organisations in the selected region
              selectedRegionData.topBuyers.length === 0 ? (
                <tr>
                  <td colSpan={4} style={styles.emptyCell}>No organisations found in this region</td>
                </tr>
              ) : (
                selectedRegionData.topBuyers.map((org, index) => (
                  <tr key={org.id || index} style={styles.tr}>
                    <td style={styles.td}>
                      <span style={styles.orgName}>{org.name}</span>
                    </td>
                    <td style={{ ...styles.td, textAlign: "right", fontWeight: 600 }}>
                      {formatCurrency(org.spend)}
                    </td>
                    <td style={{ ...styles.td, textAlign: "center" }}>
                      {org.supplierCount}
                    </td>
                    <td style={styles.td}>
                      <span style={styles.orgType}>NHS Trust</span>
                    </td>
                  </tr>
                ))
              )
            ) : regions.length === 0 ? (
              <tr>
                <td colSpan={4} style={styles.emptyCell}>No regional data found</td>
              </tr>
            ) : (
              // Show regions overview
              regions.map((region) => (
                <tr
                  key={region.name}
                  style={styles.tr}
                  onClick={() => handleRegionClick(region.name)}
                >
                  <td style={styles.td}>
                    <span style={styles.regionName}>{region.name}</span>
                  </td>
                  <td style={{ ...styles.td, textAlign: "right", fontWeight: 600 }}>
                    {formatCurrency(region.totalSpend)}
                  </td>
                  <td style={{ ...styles.td, textAlign: "center" }}>
                    {region.buyers}
                  </td>
                  <td style={styles.td}>
                    {region.topBuyers[0]?.name || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    padding: "0",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "24px",
  },
  backButton: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "8px 16px",
    backgroundColor: "#f3f4f6",
    border: "1px solid #e5e7eb",
    borderRadius: "6px",
    fontSize: "14px",
    fontWeight: 500,
    color: "#374151",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  legend: {
    display: "flex",
    gap: "20px",
    fontSize: "13px",
    color: "#666",
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  legendDot: {
    width: "12px",
    height: "12px",
    borderRadius: "3px",
  },
  regionHeader: {
    backgroundColor: "white",
    borderRadius: "12px",
    border: "1px solid #e8e8e8",
    padding: "20px 24px",
    marginBottom: "24px",
  },
  regionTitle: {
    fontSize: "24px",
    fontWeight: 600,
    color: "#1a1a2e",
    margin: "0 0 16px 0",
  },
  regionStats: {
    display: "flex",
    gap: "32px",
    alignItems: "center",
  },
  regionStat: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
  },
  regionStatValue: {
    fontSize: "20px",
    fontWeight: 600,
    color: "#1a1a2e",
  },
  regionStatLabel: {
    fontSize: "13px",
    color: "#666",
  },
  spendBadge: {
    padding: "6px 12px",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: 500,
  },
  mapSection: {
    backgroundColor: "white",
    borderRadius: "12px",
    border: "1px solid #e8e8e8",
    padding: "24px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "420px",
    marginBottom: "24px",
  },
  tableContainer: {
    backgroundColor: "white",
    borderRadius: "12px",
    border: "1px solid #e8e8e8",
    overflow: "hidden",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
  },
  th: {
    textAlign: "left" as const,
    padding: "16px 20px",
    fontSize: "13px",
    fontWeight: 600,
    color: "#555",
    borderBottom: "1px solid #eee",
    backgroundColor: "#fafafa",
  },
  tr: {
    borderBottom: "1px solid #f0f0f0",
    cursor: "pointer",
    transition: "background-color 0.15s",
  },
  td: {
    padding: "16px 20px",
    fontSize: "14px",
    color: "#333",
  },
  regionName: {
    fontWeight: 500,
    color: "#1a1a2e",
    textDecoration: "underline",
  },
  orgName: {
    fontWeight: 500,
    color: "#1a1a2e",
  },
  orgType: {
    display: "inline-block",
    padding: "4px 8px",
    backgroundColor: "#f3f4f6",
    borderRadius: "4px",
    fontSize: "12px",
    color: "#666",
  },
  loading: {
    textAlign: "center" as const,
    padding: "48px",
    color: "#888",
  },
  loadingCell: {
    textAlign: "center" as const,
    padding: "48px",
    color: "#888",
  },
  emptyCell: {
    textAlign: "center" as const,
    padding: "48px",
    color: "#888",
  },
  error: {
    backgroundColor: "#fef2f2",
    color: "#dc2626",
    padding: "12px 16px",
    borderRadius: "8px",
    marginBottom: "16px",
    fontSize: "14px",
  },
  tooltip: {
    position: "fixed" as const,
    backgroundColor: "#1a1a2e",
    color: "white",
    padding: "12px 16px",
    borderRadius: "8px",
    fontSize: "13px",
    pointerEvents: "none" as const,
    zIndex: 1000,
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
    minWidth: "160px",
  },
  tooltipTitle: {
    fontWeight: 600,
    fontSize: "14px",
    marginBottom: "8px",
    borderBottom: "1px solid rgba(255, 255, 255, 0.2)",
    paddingBottom: "6px",
  },
  tooltipRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    marginTop: "4px",
  },
  tooltipLabel: {
    color: "rgba(255, 255, 255, 0.7)",
  },
  tooltipValue: {
    fontWeight: 600,
  },
};
