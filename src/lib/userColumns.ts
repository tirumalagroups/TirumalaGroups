// The columns of public.users the app reads. Never "*": once login security is switched on, the
// password columns cannot be read by anyone through the app, so asking for them fails.
export const USER_COLUMNS = [
  'id', 'username', 'email', 'user_type_id', 'is_active', 'mode', 'aadhaar_number', 'address', 'phone',
  'full_name', 'date_of_birth', 'other_details', 'created_at', 'updated_at', 'status', 'employee_id',
  'designation', 'branch', 'created_by', 'last_login', 'last_password_change', 'login_count',
  'failed_login_attempts', 'password_expired', 'password_expiry_date', 'deleted_by', 'deleted_at',
  'deletion_reason', 'auth_user_id', 'locked_until', 'must_change_password',
].join(', ');
