
export const USER_TYPES = {
  USER: 'user',
  ADMIN: 'admin',
};

// Convert objects to arrays for Mongoose enum validation
export const getUserTypesArray = () => Object.values(USER_TYPES);
