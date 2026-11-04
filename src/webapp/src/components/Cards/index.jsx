import {
  Route,
  Routes,
} from 'react-router-dom';

import Grid from '@mui/material/Grid';

import CardsOverview from './overview';
import CardsEdit from './edit';
import CardsRegister from './register';
import CardsBulk from './bulk';

const Cards = () => {
  return (
    <Grid
      container
      sx={{ minWidth: 0 }}
    >
      <Routes>
        <Route
          index
          element={<CardsOverview />}
        />
        <Route
          path=":cardId/edit"
          element={<CardsEdit/>}
        />
        <Route
          path="register"
          element={<CardsRegister/>}
        />
        <Route
          path="bulk"
          element={<CardsBulk/>}
        />
      </Routes>
    </Grid>
  );
};

export default Cards;
