import axios from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // send refresh_token httpOnly cookie
});

// Helper to attach auth token to requests
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers = config.headers || {};
      config.headers['Authorization'] = `Bearer ${token}`;
    }
  }
  return config;
});

// -----------------------------------------------------------------------------
// Access token refresh handling
//
// If an API call returns 401, we attempt a refresh using the httpOnly refresh
// cookie, then retry the original request once.

let _refreshing = false;
let _queue: Array<(token: string | null) => void> = [];

async function _refreshAccessToken(): Promise<string | null> {
  try {
    const resp = await api.post('/auth/refresh');
    const token = resp.data?.access_token as string | undefined;
    if (token && typeof window !== 'undefined') {
      localStorage.setItem('access_token', token);
    }
    return token || null;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config || {};
    const status = error.response?.status;
    if (status !== 401 || original._retry) {
      return Promise.reject(error);
    }
    original._retry = true;

    if (_refreshing) {
      return new Promise((resolve, reject) => {
        _queue.push((token) => {
          if (!token) return reject(error);
          original.headers = original.headers || {};
          original.headers['Authorization'] = `Bearer ${token}`;
          resolve(api(original));
        });
      });
    }

    _refreshing = true;
    const newToken = await _refreshAccessToken();
    _queue.forEach((cb) => cb(newToken));
    _queue = [];
    _refreshing = false;

    if (!newToken) {
      // refresh failed; clear local access token
      if (typeof window !== 'undefined') {
        localStorage.removeItem('access_token');
      }
      return Promise.reject(error);
    }

    original.headers = original.headers || {};
    original.headers['Authorization'] = `Bearer ${newToken}`;
    return api(original);
  }
);

export async function signup(email: string, password: string) {
  return api.post('/users', { email, password });
}

export async function login(email: string, password: string) {
  const params = new URLSearchParams();
  params.append('username', email);
  params.append('password', password);
  params.append('scope', '');
  params.append('grant_type', '');
  params.append('client_id', '');
  params.append('client_secret', '');
  return api.post('/token', params, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
}

// -----------------------------------------------------------------------------
// Phase B: verification + password reset

export async function resendVerification(email: string) {
  return api.post('/auth/resend_verification', { email });
}

export async function verifyEmail(token: string) {
  return api.post('/auth/verify', { token });
}

export async function requestPasswordReset(email: string) {
  return api.post('/auth/password/forgot', { email });
}

export async function resetPassword(token: string, new_password: string) {
  return api.post('/auth/password/reset', { token, new_password });
}

// -----------------------------------------------------------------------------
// Sessions / auth management

export async function logout() {
  return api.post('/auth/logout');
}

export async function logoutAll() {
  return api.post('/auth/logout_all');
}

export async function listSessions() {
  return api.get('/auth/sessions');
}

export async function revokeSession(session_id: string) {
  return api.delete(`/auth/sessions/${session_id}`);
}

export async function getFeed(skip = 0, limit = 10, trending = false) {
  return api.get('/feed', { params: { skip, limit, trending } });
}

// Feed v2 (cursor pagination + denormalized info)
export async function getFeedV2(params: {
  limit?: number;
  cursor?: string | null;
  mode?: 'for_you' | 'following' | 'trending';
  q?: string;
  niche?: string;
  style?: string;
} = {}) {
  return api.get('/feed/v2', { params });
}

export async function getCommentsV2(postId: number, params: {
  limit?: number;
  cursor?: string | null;
} = {}) {
  return api.get(`/posts/${postId}/comments/v2`, { params });
}

export async function followInfluencer(influencerId: number) {
  return api.post(`/influencers/${influencerId}/follow`);
}

export async function unfollowInfluencer(influencerId: number) {
  return api.delete(`/influencers/${influencerId}/follow`);
}

export async function likePost(postId: number) {
  return api.post(`/posts/${postId}/like`);
}

export async function unlikePost(postId: number) {
  return api.delete(`/posts/${postId}/like`);
}

export async function commentOnPost(postId: number, content: string) {
  return api.post(`/posts/${postId}/comments`, { content });
}

export async function createInfluencer(payload: { name: string; bio: string; niche: string; style: string; face_url?: string; lore?: string }) {
  return api.post('/influencers', payload);
}

export async function buildInfluencer(payload: {
  niche: string;
  vibe: string;
  posting_frequency: number;
  seed?: number;
  llm_provider?: string;
  llm_model?: string;
}) {
  return api.post('/influencers/build', payload);
}

export async function previewInfluencer(payload: {
  niche: string;
  vibe: string;
  posting_frequency: number;
  seed?: number;
  llm_provider?: string;
  llm_model?: string;
}) {
  return api.post('/influencers/preview', payload);
}

export async function getTaskStatus(taskId: string) {
  return api.get(`/tasks/${taskId}`);
}

export async function getInfluencer(id: number) {
  return api.get(`/influencers/${id}`);
}

export async function updateReplyMode(influencerId: number, mode: string) {
  return api.post(`/influencers/${influencerId}/reply_mode`, { reply_mode: mode });
}

export async function searchInfluencers(params: {
  q?: string;
  niche?: string;
  style?: string;
  sort?: 'popularity' | 'new';
  skip?: number;
  limit?: number;
}) {
  return api.get('/influencers/search', { params });
}

export async function getRecommendedInfluencers(limit = 10) {
  return api.get('/influencers/recommended', { params: { limit } });
}

export function getEventsUrl() {
  return `${API_BASE.replace(/\/$/, '')}/events`;
}

export async function getMyDashboard() {
  return api.get('/dashboard/me');
}

export async function getMe() {
  return api.get('/users/me');
}

// -----------------------------------------------------------------------------
// Onboarding
//

export async function getOnboardingStatus() {
  return api.get('/onboarding/me');
}

export async function updateOnboardingPreferences(payload: {
  preferred_niches: string[];
  preferred_styles?: string[];
}) {
  return api.post('/onboarding/preferences', payload);
}

export async function getOnboardingSuggestions(limit = 20) {
  return api.get('/onboarding/suggestions', { params: { limit } });
}

export async function completeOnboarding() {
  return api.post('/onboarding/complete');
}

export async function getInfluencerAnalytics(influencerId: number, days = 30) {
  return api.get(`/influencers/${influencerId}/analytics`, { params: { days } });
}

export async function createTrade(payload: {
  influencer_id: number;
  amount: number;
  trade_type: 'buy' | 'sell';
}) {
  return api.post('/trades', payload);
}

// -----------------------------------------------------------------------------
// Notifications (persistent)
//

export async function getNotifications(params: {
  unread_only?: boolean;
  status?: 'all' | 'unread' | 'read';
  notif_type?: string;
  search?: string;
  since?: string;
  until?: string;
  skip?: number;
  limit?: number;
} = {}) {
  return api.get('/notifications', { params });
}

// -----------------------------------------------------------------------------
// Market / token data
//

export async function listTokenMarkets(skip = 0, limit = 50) {
  return api.get('/market/tokens', { params: { skip, limit } });
}

export async function getTokenMarket(influencerId: number) {
  return api.get(`/market/tokens/${influencerId}`);
}

export async function getOrderbook(influencerId: number, levels = 6) {
  return api.get(`/market/orderbook/${influencerId}`, { params: { levels } });
}

export async function getPosition(influencerId: number) {
  return api.get(`/market/position/${influencerId}`);
}

export async function getTradeTape(influencerId: number, limit = 30) {
  return api.get(`/market/tape/${influencerId}`, { params: { limit } });
}

export async function getUnreadCount() {
  return api.get('/notifications/unread_count');
}

// -----------------------------------------------------------------------------
// Growth loops: daily challenges, polls, gamification, sharing

export async function getLoopsStatus() {
  return api.get('/loops/status');
}

export async function getTodayChallenge() {
  return api.get('/loops/challenges/today');
}

export async function voteDailyChallenge(challengeId: number, option_index: number) {
  return api.post(`/loops/challenges/${challengeId}/vote`, { option_index });
}

export async function votePoll(postId: number, option_index: number) {
  return api.post(`/posts/${postId}/poll/vote`, { option_index });
}

export async function sharePost(postId: number) {
  return api.post(`/posts/${postId}/share`);
}

// -----------------------------------------------------------------------------
// Creator Studio
//

export async function getMyInfluencers() {
  return api.get('/studio/influencers');
}

export async function getDrafts(influencerId: number) {
  return api.get(`/studio/influencers/${influencerId}/drafts`);
}

export async function getCalendar(influencerId: number, start: string, end: string) {
  return api.get(`/studio/influencers/${influencerId}/calendar`, { params: { start, end } });
}

export async function updateStudioPost(postId: number, payload: any) {
  return api.patch(`/studio/posts/${postId}`, payload);
}

export async function deleteStudioPost(postId: number) {
  return api.delete(`/studio/posts/${postId}`);
}

export async function regenerateStudioPost(postId: number, payload: {
  llm_provider?: string;
  llm_model?: string;
  seed?: number;
} = {}) {
  return api.post(`/studio/posts/${postId}/regenerate`, null, { params: payload });
}

export async function generatePostsPreview(influencerId: number, payload: {
  count?: number;
  mode?: string;
  seed?: number;
  llm_provider?: string;
  llm_model?: string;
}) {
  return api.post(`/studio/influencers/${influencerId}/generate_preview`, payload);
}

export async function commitGeneratedPosts(influencerId: number, payload: {
  seed: number;
  items: any[];
  schedule_start?: string | null;
}) {
  return api.post(`/studio/influencers/${influencerId}/commit_generated`, payload);
}

export async function markNotificationRead(notificationId: number) {
  return api.post(`/notifications/${notificationId}/read`);
}

export async function markAllNotificationsRead() {
  return api.post('/notifications/read_all');
}