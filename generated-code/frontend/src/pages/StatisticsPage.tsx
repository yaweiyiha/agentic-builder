import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ProductivityChart from '../components/statistics/ProductivityChart';
import Navbar from '../components/Navbar'; // Assuming Navbar is available

// Mock API call for statistics
interface SummaryData {
  totalWorkSessions: number;
  totalBreakSessions: number;
  totalWorkTimeMinutes: number;
  totalBreakTimeMinutes: number;
}

interface ChartDataPoint {
  label: string;
  workSessions: number;
  breakSessions: number;
}

interface StatisticsResponse {
  summary: SummaryData;
  chartData: ChartDataPoint[];
}

const mockFetchStatistics = async (
  timeRange: 'today' | 'last7days' | 'last30days' | 'custom'
): Promise<StatisticsResponse> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      let summary: SummaryData;
      let chartData: ChartDataPoint[] = [];

      const today = new Date();
      const formatDate = (date: Date) => date.toISOString().split('T')[0];

      switch (timeRange) {
        case 'today':
          summary = {
            totalWorkSessions: 3,
            totalBreakSessions: 3,
            totalWorkTimeMinutes: 75,
            totalBreakTimeMinutes: 15,
          };
          chartData = [
            { label: formatDate(today), workSessions: 3, breakSessions: 3 },
          ];
          break;
        case 'last7days':
          summary = {
            totalWorkSessions: 21,
            totalBreakSessions: 20,
            totalWorkTimeMinutes: 525,
            totalBreakTimeMinutes: 100,
          };
          for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            chartData.push({
              label: formatDate(d),
              workSessions: Math.floor(Math.random() * 5) + 1,
              breakSessions: Math.floor(Math.random() * 4) + 1,
            });
          }
          break;
        case 'last30days':
          summary = {
            totalWorkSessions: 90,
            totalBreakSessions: 85,
            totalWorkTimeMinutes: 2250,
            totalBreakTimeMinutes: 425,
          };
          for (let i = 29; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            chartData.push({
              label: formatDate(d),
              workSessions: Math.floor(Math.random() * 4),
              breakSessions: Math.floor(Math.random() * 3),
            });
          }
          break;
        case 'custom': // For simplicity, custom will also return last 7 days mock
        default:
          summary = {
            totalWorkSessions: 15,
            totalBreakSessions: 14,
            totalWorkTimeMinutes: 375,
            totalBreakTimeMinutes: 70,
          };
          for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            chartData.push({
              label: formatDate(d),
              workSessions: Math.floor(Math.random() * 5) + 1,
              breakSessions: Math.floor(Math.random() * 4) + 1,
            });
          }
          break;
      }
      resolve({ summary, chartData });
    }, 500); // Simulate network delay
  });
};

const formatMinutesToHHMM = (totalMinutes: number): string => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};

const StatisticsPage: React.FC = () => {
  const [timeRange, setTimeRange] = useState<'today' | 'last7days' | 'last30days' | 'custom'>('last7days');

  const { data, isLoading, isError } = useQuery<StatisticsResponse, Error>({
    queryKey: ['statistics', timeRange],
    queryFn: () => mockFetchStatistics(timeRange),
  });

  const handleTimeRangeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setTimeRange(event.target.value as typeof timeRange);
  };

  const summary = data?.summary;
  const chartData = data?.chartData || [];

  return (
    <div className="min-h-screen bg-[#0F172A] text-[#F1F5F9] flex flex-col">
      <Navbar />
      <main className="flex-grow p-[24px] max-w-[1200px] mx-auto w-full">
        <h2 className="text-[32px] font-bold mb-[24px] text-[#F1F5F9]">Statistics Dashboard</h2>

        {isLoading && (
          <div className="text-center text-[18px] text-[#CBD5E1]">Loading statistics...</div>
        )}

        {isError && (
          <div className="text-center text-[18px] text-[#EF4444]">Error loading statistics. Please try again.</div>
        )}

        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-[16px] mb-[32px]">
            <div className="bg-[#1E293B] p-[20px] rounded-[8px] shadow-md">
              <h3 className="text-[16px] font-semibold text-[#CBD5E1]">Total Work Sessions</h3>
              <p className="text-[28px] font-bold text-[#F1F5F9] mt-[8px]">{summary.totalWorkSessions}</p>
            </div>
            <div className="bg-[#1E293B] p-[20px] rounded-[8px] shadow-md">
              <h3 className="text-[16px] font-semibold text-[#CBD5E1]">Total Break Sessions</h3>
              <p className="text-[28px] font-bold text-[#F1F5F9] mt-[8px]">{summary.totalBreakSessions}</p>
            </div>
            <div className="bg-[#1E293B] p-[20px] rounded-[8px] shadow-md">
              <h3 className="text-[16px] font-semibold text-[#CBD5E1]">Total Work Time</h3>
              <p className="text-[28px] font-bold text-[#F1F5F9] mt-[8px]">{formatMinutesToHHMM(summary.totalWorkTimeMinutes)}</p>
            </div>
            <div className="bg-[#1E293B] p-[20px] rounded-[8px] shadow-md">
              <h3 className="text-[16px] font-semibold text-[#CBD5E1]">Total Break Time</h3>
              <p className="text-[28px] font-bold text-[#F1F5F9] mt-[8px]">{formatMinutesToHHMM(summary.totalBreakTimeMinutes)}</p>
            </div>
          </div>
        )}

        <div className="mb-[24px] flex justify-end">
          <label htmlFor="timeRange" className="sr-only">Select Date Range</label>
          <select
            id="timeRange"
            value={timeRange}
            onChange={handleTimeRangeChange}
            className="bg-[#1E293B] text-[#F1F5F9] border border-[#334155] rounded-[6px] p-[8px] focus:ring-[#2563eb] focus:border-[#2563eb] cursor-pointer"
          >
            <option value="today">Today</option>
            <option value="last7days">Last 7 Days</option>
            <option value="last30days">Last 30 Days</option>
            <option value="custom" disabled>Custom Range (P2)</option>
          </select>
        </div>

        <h3 className="text-[24px] font-bold mb-[16px] text-[#F1F5F9]">Productivity Trends</h3>
        <ProductivityChart data={chartData} timeRange={timeRange} />
      </main>
    </div>
  );
};

export default StatisticsPage;
