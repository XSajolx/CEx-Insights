import { startOfMonth, endOfMonth, eachDayOfInterval, format, subMonths } from 'date-fns';

const TOPICS = [
  'Payment Related Issues',
  'Challenge Rule Clarification',
  'Account Verification',
  'Platform Technical Issues',
  'Withdrawal Request',
  'Subscription Renewal',
  'New User Onboarding',
  'General Inquiry'
];

const REGIONS = ['North America', 'Europe', 'Asia Pacific', 'Latin America', 'Middle East'];
const COUNTRIES = {
  'North America': ['USA', 'Canada'],
  'Europe': ['UK', 'Germany', 'France', 'Spain'],
  'Asia Pacific': ['India', 'Australia', 'Japan', 'Singapore'],
  'Latin America': ['Brazil', 'Mexico'],
  'Middle East': ['UAE', 'Saudi Arabia']
};
const PRODUCTS = ['Stellar', 'Evaluation', 'Express', 'Lite'];
const CHANNELS = ['Chat', 'Email', 'Bot'];

const generateRandomId = () => Math.floor(Math.random() * 1000000000000).toString();

const getRandomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const generateMockData = () => {
  const data = [];
  const endDate = new Date();
  const startDate = subMonths(endDate, 3); // Generate 3 months of data

  const days = eachDayOfInterval({ start: startDate, end: endDate });

  days.forEach(day => {
    // Generate random number of conversations per day (20-50)
    const dailyCount = Math.floor(Math.random() * 30) + 20;

    for (let i = 0; i < dailyCount; i++) {
      const region = getRandomItem(REGIONS);
      const country = getRandomItem(COUNTRIES[region]);
      
      data.push({
        created_date_bd: format(day, 'yyyy-MM-dd'),
        conversation_id: generateRandomId(),
        country: country,
        region: region,
        product: getRandomItem(PRODUCTS),
        assigned_channel_name: getRandomItem(CHANNELS),
        cx_score_rating: Math.floor(Math.random() * 5) + 1, // 1-5 rating
        topic: getRandomItem(TOPICS)
      });
    }
  });

  return data;
};

export const MOCK_DATA = generateMockData();
