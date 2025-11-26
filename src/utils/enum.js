
export const USER_TYPES = {
  USER: 'user',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin'
};

// Convert objects to arrays for Mongoose enum validation
export const getUserTypesArray = () => Object.values(USER_TYPES);
