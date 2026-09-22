import {
  Route,
  Routes,
} from 'react-router-dom';

import Grid from '@mui/material/Grid';

import CardsOverview from './overview';
import CardsEdit from './edit';
import CardsRegister from './register';
import CardsSeries from './series';

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
          path="series"
          element={<CardsSeries/>}
        />
      </Routes>
    </Grid>
  );
};

export default Cards;
