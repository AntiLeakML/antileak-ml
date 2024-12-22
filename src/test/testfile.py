# oversampling datasets , new rows are synthesized based on existing rows
X_new , y_new = SMOTE () . fit_resample (X , y )

# splits after over - sampling no longer produce independent train / test data
X_train , X_test , y_train , y_test = train_test_split (
X_new , y_new , test_size =0.2 , random_state =42)

rf = RandomForestClassifier () . fit ( X_train , y_train )
rf . predict ( X_test )

# select the best model with repeated evaluation
results = []
for clf , name in ( ( DecisionTreeClassifier () , " Decision Tree ") , ( Perceptron () , " Perceptron ") ) :
    clf . fit ( X_train , y_train )
    pred = clf . predict ( X_test )
    score = metrics . accuracy_score ( y_test , pred )
    results . append ( score , name )

# unknown words in test data leak into training data
wordsVectorizer = CountVectorizer () . fit ( text )
wordsVector = wordsVectorizer . transform ( text )
invTransformer = TfidfTransformer () . fit ( wordsVector )
invFreqOfWords = invTransformer . transform ( wordsVector )
X = pd . DataFrame ( invFreqOfWords . toarray () )

train , test , spamLabelTrain , spamLabelTest = train_test_split (X , y , test_size = 0.5)
predictAndReport ( train = train , test = test )