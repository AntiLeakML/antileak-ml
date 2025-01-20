from time import time

from pprint import pprint

from collections import defaultdict





from IPython import display

from matplotlib import cm

import warnings



import numpy as np

import pandas as pd

import matplotlib.pyplot as plt

import seaborn as sns; sns.set()



from sklearn.cluster import KMeans

from scipy.stats import describe, kurtosis

from sklearn.decomposition import FastICA, PCA

from sklearn.preprocessing import MinMaxScaler

from sklearn.mixture import GaussianMixture

from sklearn.metrics import adjusted_mutual_info_score as ami

from sklearn.metrics import silhouette_samples, silhouette_score

from sklearn.preprocessing import LabelEncoder, MinMaxScaler, normalize

from sklearn.discriminant_analysis import LinearDiscriminantAnalysis as LDA

from sklearn.random_projection import SparseRandomProjection, johnson_lindenstrauss_min_dim

data = pd.read_csv("../data/heart.csv")

X = data.loc[:, data.columns != 'target']

y = data.loc[:, data.columns == 'target'].values.ravel()

scaler = MinMaxScaler()

X = scaler.fit_transform(X)

# # Clustering

# ## K-Means

n_clusters = np.hstack(np.arange(2, 13)).astype(np.int)

km_res = defaultdict(dict)

for k in n_clusters:

    km = KMeans(n_clusters=k,

                random_state=0)

    t0 = time()

    km.fit(X)

    t = time() - t0

    y_km = km.predict(X)

    km_res[k]['dist'] = km.inertia_

    km_res[k]['time'] = t

    km_res[k]['sil'] = silhouette_score(X, y_km, random_state=0)

    with warnings.catch_warnings():

        warnings.simplefilter("ignore")

        km_res[k]['ami'] = ami(y, y_km)

    print('done k=%i in %.3f sec' % (k, t))

plt.plot(n_clusters, [km_res[k]['dist'] for k in n_clusters])

plt.xlabel('n_clusters')

plt.ylabel('Sum of Squared Distances')

plt.title("K-Means vs Sum of Squared Distances")

plt.show()

plt.plot(n_clusters, [km_res[k]['ami'] for k in n_clusters])

plt.xlabel('n_clusters')

plt.ylabel('Adj. Mutual Information')

plt.title("K-Means vs Adj. Mutual Information")

plt.xlim([0, 13])

plt.show()

plt.plot(n_clusters, [km_res[k]['sil'] for k in n_clusters])

plt.xlabel('n_clusters')

plt.ylabel('Average Silhoutte Score')

plt.title("K-Means vs Average Silhoutte Score")

plt.xlim([0, 13])

plt.show()

km = KMeans(n_clusters=2,

                random_state=0)

y_km = km.fit_predict(X)

cluster_labels = np.unique(y_km)

m_clusters = cluster_labels.shape[0]

silhouette_vals = silhouette_samples(X, y_km, metric='euclidean')

y_ax_lower, y_ax_upper = 0,0

yticks = []

for i, c in enumerate(cluster_labels):

    c_silhouette_vals = silhouette_vals[y_km == c]

    c_silhouette_vals.sort()

    y_ax_upper += len(c_silhouette_vals)

    color = cm.jet(float(i) / m_clusters)

    plt.barh(range(y_ax_lower, y_ax_upper),

             c_silhouette_vals, 

             height=1.0,

             edgecolor='none',

             color=color)

    yticks.append((y_ax_lower + y_ax_upper) / 2.)

    y_ax_lower += len(c_silhouette_vals)

silhouette_avg = np.mean(silhouette_vals)

plt.axvline(silhouette_avg,

            color="red",

            linestyle="--") 

plt.yticks(yticks, cluster_labels + 1)

plt.ylabel('Cluster')

plt.xlabel('Silhouette Coefficient')

plt.title("K-Means vs Average Silhouette Coefficient")

plt.show()

# ## Expectation Maximization

em_res = defaultdict(dict)

for k in n_clusters:

    gm = GaussianMixture(

        n_components=k,

        random_state=0,

#         n_jobs=-1, # Not supported for GMM?

        n_init=1,

        init_params='kmeans',

#         max_iter=600,

    )

    t0 = time()

    gm.fit(X)

    t = time() - t0

    y_gm = gm.predict(X)

    em_res[k]['bic'] = gm.bic(X)

    em_res[k]['aic'] = gm.aic(X)

    em_res[k]['ll'] = gm.score(X)

    em_res[k]['time'] = t

    em_res[k]['sil'] = silhouette_score(X, y_gm, random_state=0)

    with warnings.catch_warnings():

        warnings.simplefilter("ignore")

        em_res[k]['ami'] = ami(y, y_gm)

    print('done k=%i in %.3f sec' % (k, t))

plt.plot(n_clusters, [em_res[k]['ll'] for k in n_clusters])

plt.xlabel('n_components')

plt.ylabel('Log likelihood')

plt.title("Expectation Maximization vs Log likelihood")

plt.show()

plt.plot(n_clusters, [em_res[k]['sil'] for k in n_clusters])

plt.xlabel('n_components')

plt.ylabel('Average Silhouette Score')

plt.title("Expectation Maximization vs Average Silhouette Score")

plt.show()

plt.plot(n_clusters, [em_res[k]['ami'] for k in n_clusters])

plt.xlabel('n_components')

plt.ylabel('Adj. Mutual Information')

plt.title("Expectation Maximization vs Adj. Mutual Information")

plt.xlim([0, 13])

plt.show()

plt.plot(n_clusters, [em_res[k]['bic'] for k in n_clusters], label='BIC')

plt.plot(n_clusters, [em_res[k]['aic'] for k in n_clusters], label='AIC')

plt.legend(loc='best')

plt.xlabel('n_clusters')

plt.title("Expectation Maximization vs AIC/BIC")

plt.show()

# # Dimensionality Reduction

# ## PCA

pca = PCA(n_components=None, random_state=0)

pca.fit(X)

normed = pca.components_[1] / np.linalg.norm(pca.components_[1])

s = pd.Series(normed)

data.drop('target', axis=1).columns[s.abs() > 0.25]

plt.bar(range(1, pca.n_components_ + 1), pca.explained_variance_ratio_, 

        align='center', alpha=0.5, label='Individual explained variance')

plt.step(range(1, pca.n_components_ + 1), np.cumsum(pca.explained_variance_ratio_), 

        where='mid', label='Cumulative explained variance')

plt.xlim([0, 15])

plt.title("PCA vs Explained Variance")

plt.show()

plt.plot(range(1, pca.n_components_ + 1), np.cumsum(pca.explained_variance_ratio_))

plt.ylabel('Cumulative explained variance')

plt.xlabel('Number of components')

plt.title("PCA vs Number of Components")

plt.axvline(15, linestyle='--', color='k', alpha=0.5)

# ## ICA

ica = FastICA(

    n_components=10,

    random_state=0,

    max_iter=400,

)

X_tr = ica.fit_transform(X)

kurt_df = pd.DataFrame(kurtosis(X_tr, axis=0), columns=['kurtosis'])

kurt_df.sort_values(by='kurtosis', ascending=False)

# Kurtosis: higher values indicate the presence of tail extremity, i.e. more data outside of the peak. It's a measure of non-gaussianity and is the basis of ICA.

component_counts = np.hstack((np.arange(1, 13),)).astype(np.int)

total_kurtosis = {}



for component_count in component_counts:

    tmp_ica = FastICA(

        random_state=0,

        n_components=component_count,

    )

    tmp_X_tr = tmp_ica.fit_transform(X)

    total_kurtosis[component_count] = np.abs(kurtosis(tmp_X_tr, axis=0)).sum()



pprint(total_kurtosis)

res = sum(total_kurtosis.values()) / len(total_kurtosis)

res

pd.Series(total_kurtosis).plot()

plt.ylabel('Total kurtosis')

plt.xlabel('Number of ICA components')

plt.title("ICA vs Number of Components")

ica10 = FastICA(

    random_state=0,

    n_components=10,

)

X_tr10 = ica10.fit_transform(X)

kurt_df10 = pd.DataFrame(kurtosis(X_tr10, axis=0), columns=['kurtosis'])

kurt_df10.sort_values(by='kurtosis', ascending=False)

normed = ica10.components_[6] / np.linalg.norm(ica10.components_[6])

np.set_printoptions(suppress=True)

normed.astype(np.float)

s = pd.Series(normed)

data.drop('target', axis=1).columns[s.abs() > 0.1]

normed = ica10.components_[1] / np.linalg.norm(ica10.components_[1])

np.set_printoptions(suppress=True)

normed.astype(np.float)

s = pd.Series(normed)

data.drop('target', axis=1).columns[s.abs() > 0.1]

# ## Randomized Projections

rp = SparseRandomProjection(n_components=5)

rp.fit(X)

eps = np.linspace(0, 1.0, 10)

n_samples = X.shape[0]

n_component_bounds = johnson_lindenstrauss_min_dim(n_samples)

component_counts = np.array([1, 2, 10, 20, 30, 50, 75, 100]).astype(np.int)

rp = SparseRandomProjection(

        random_state=0,

        n_components=1,

        eps=None

    )

rp.fit(X)

rp_components = rp.components_

rp_components.shape

# for _ in range(10):

#     rp = SparseRandomProjection(

#         random_state=0,

#         n_components=50,

#         eps=None

#     )

    

#     np.hstack()

# ## LDA

lda = LDA(

    n_components=None,

)

X_tr = lda.fit_transform(X, y)

X_tr.shape

describe(X_tr)

n_lda_components = lda.explained_variance_ratio_.shape[0]

plt.plot(range(1, n_lda_components + 1), np.cumsum(lda.explained_variance_ratio_))

plt.ylabel('Cumulative explained variance')

plt.xlabel('Number of components')

# plt.axvline(29, linestyle='--', color='k', alpha=0.5)

# # Dimensionality Reduction + Clustering

# ## PCA

component_counts = [1,2,3,4,5,6,7,8,9,10,11,12,13]

pca_km_results = {}



for cc in component_counts:

    tmp_pca = PCA(n_components=cc, random_state=0)

    tmp_X_tr = tmp_pca.fit_transform(X)

    tmp_res = defaultdict(dict)

    print('Doing %i components' % cc)

    for k in n_clusters:

        km = KMeans(

            n_clusters=k,

            random_state=0

        )

        t0 = time()

        km.fit(tmp_X_tr)

        t = time() - t0

        y_km = km.predict(tmp_X_tr)

        tmp_res[k]['dist'] = km.inertia_

        tmp_res[k]['time'] = t

        tmp_res[k]['sil'] = silhouette_score(tmp_X_tr, y_km, random_state=0)

        with warnings.catch_warnings():

            warnings.simplefilter("ignore")

            tmp_res[k]['ami'] = ami(y, y_km)

        print('done k=%i in %.3f sec' % (k, t))

    pca_km_results[cc] = tmp_res

    


test_pca = PCA(n_components=2)

x_tr_test = test_pca.fit_transform(X)

test_cluster = KMeans(n_clusters=2)

clusters_test = test_cluster.fit_predict(x_tr_test)

print(x_tr_test.shape, clusters_test.shape)

print(np.hstack((x_tr_test, clusters_test[:, None])))

pca_gm_results = {}

# component_counts = [5, 10, 13]



for cc in component_counts:

    tmp_pca = PCA(n_components=cc, random_state=0)

    tmp_X_tr = tmp_pca.fit_transform(X)

    tmp_res = defaultdict(dict)

    print('Doing %i components' % cc)

    tmp_res = defaultdict(dict)

    for k in n_clusters:

        gm = GaussianMixture(

            n_components=k,

            random_state=0,

            n_init=1,

            init_params='kmeans',

        )

        t0 = time()

        gm.fit(tmp_X_tr)

        t = time() - t0

        y_gm = gm.predict(tmp_X_tr)

        tmp_res[k]['bic'] = gm.bic(tmp_X_tr)

        tmp_res[k]['aic'] = gm.aic(tmp_X_tr)

        tmp_res[k]['ll'] = gm.score(tmp_X_tr)

        tmp_res[k]['time'] = t

        tmp_res[k]['sil'] = silhouette_score(tmp_X_tr, y_gm, random_state=0)

        with warnings.catch_warnings():

            warnings.simplefilter("ignore")

            tmp_res[k]['ami'] = ami(y, y_gm)

        print('done k=%i in %.3f sec' % (k, t))

    pca_gm_results[cc] = tmp_res

# component_counts = [5, 10, 13]

# pca_km_results = {cc: load_cluster_result(dataset, 'km', 'pca%i' % cc) for cc in component_counts}

# pca_gm_results = {cc: load_cluster_result(dataset, 'em', 'pca%i' % cc) for cc in component_counts}

for cc in component_counts:

    plt.plot(n_clusters, [pca_km_results[cc][k]['dist'] for k in n_clusters], label='%i components' % cc)



plt.xlabel('n_clusters')

plt.ylabel('Distortion')

plt.legend(loc='best')

plt.xlim([0,13])

plt.show()

for cc in component_counts:

    plt.plot(n_clusters, [pca_km_results[cc][k]['ami'] for k in n_clusters], label='%i components' % cc)

plt.xlabel('n_clusters')

plt.ylabel('Adj. Mutual Information')

plt.xlim([0, 13])

plt.legend(loc='best')

plt.show()

for cc in component_counts:

    plt.plot(n_clusters, [pca_gm_results[cc][k]['ll'] for k in n_clusters], label='%i components' % cc)

plt.xlabel('n_clusters')

plt.ylabel('Log likelihood')

plt.xlim([0, 13])

plt.legend(loc='best')

plt.show()

for cc in component_counts:

    plt.plot(n_clusters, [pca_gm_results[cc][k]['ami'] for k in n_clusters], label='%i components' % cc)

plt.xlabel('n_clusters')

plt.ylabel('Adj. Mutual Information')

plt.legend(loc='best')

plt.xlim([0,13])

plt.show()

for cc in component_counts:

    plt.plot(n_clusters, [pca_gm_results[cc][k]['aic'] for k in n_clusters], label='%i components' % cc)

plt.legend(loc='best')

plt.ylabel('AIC')

plt.xlabel('n_clusters')

plt.show()

for cc in component_counts:

    plt.plot(n_clusters, [pca_gm_results[cc][k]['bic'] for k in n_clusters], label='%i components' % cc)

plt.legend(loc='best')

plt.ylabel('BIC')

plt.xlabel('n_clusters')

plt.show()

# ## ICA

component_counts = [1,2,3,4,5,6,7,8,9,10,11,12,13]

# component_counts = [1, 2, 10, 20, 30, 60, 70, 80]

ica_km_results = {}



for cc in component_counts:

    tmp_dr = FastICA(n_components=cc, random_state=0)

    tmp_X_tr = tmp_dr.fit_transform(X)

    tmp_res = defaultdict(dict)

    print('Doing %i components' % cc)

    for k in n_clusters:

        km = KMeans(

            n_clusters=k,

            random_state=0

        )

        t0 = time()

        km.fit(tmp_X_tr)

        t = time() - t0

        y_km = km.predict(tmp_X_tr)

        tmp_res[k]['dist'] = km.inertia_

        tmp_res[k]['time'] = t

        tmp_res[k]['sil'] = silhouette_score(tmp_X_tr, y_km, random_state=0)

        with warnings.catch_warnings():

            warnings.simplefilter("ignore")

            tmp_res[k]['ami'] = ami(y, y_km)

        print('done k=%i in %.3f sec' % (k, t))

    ica_km_results[cc] = tmp_res

for cc in component_counts:

    plt.plot(n_clusters, [ica_km_results[cc][k]['dist'] for k in n_clusters], label='%i components' % cc)



plt.xlabel('n_clusters')

plt.ylabel('Distortion')

plt.legend(loc='best')

plt.show()

for cc in component_counts:

    plt.plot(n_clusters, [ica_km_results[cc][k]['ami'] for k in n_clusters], label='%i components' % cc)

plt.xlabel('n_clusters')

plt.ylabel('Adj. Mutual Information')

plt.xlim([0, 13])

plt.legend(loc='best')

plt.show()

ica_gm_results = {}



for cc in component_counts:

    tmp_dr = FastICA(n_components=cc, random_state=0)

    tmp_X_tr = tmp_dr.fit_transform(X)

    tmp_res = defaultdict(dict)

    print('Doing %i components' % cc)

    tmp_res = defaultdict(dict)

    for k in n_clusters:

        gm = GaussianMixture(

            n_components=k,

            random_state=0,

            n_init=1,

            init_params='kmeans',

        )

        t0 = time()

        gm.fit(tmp_X_tr)

        t = time() - t0

        y_gm = gm.predict(tmp_X_tr)

        tmp_res[k]['bic'] = gm.bic(tmp_X_tr)

        tmp_res[k]['aic'] = gm.aic(tmp_X_tr)

        tmp_res[k]['ll'] = gm.score(tmp_X_tr)

        tmp_res[k]['time'] = t

        tmp_res[k]['sil'] = silhouette_score(tmp_X_tr, y_gm, random_state=0)

        with warnings.catch_warnings():

            warnings.simplefilter("ignore")

            tmp_res[k]['ami'] = ami(y, y_gm)

        print('done k=%i in %.3f sec' % (k, t))

    ica_gm_results[cc] = tmp_res

for cc in component_counts:

    plt.plot(n_clusters, [ica_gm_results[cc][k]['ll'] for k in n_clusters], label='%i components' % cc)

plt.xlabel('n_clusters')

plt.ylabel('Log likelihood')

plt.xlim([0, 13])

plt.legend(loc='best')

plt.show()

for cc in component_counts:

    plt.plot(n_clusters, [ica_gm_results[cc][k]['ami'] for k in n_clusters], label='%i components' % cc)

plt.xlabel('n_clusters')

plt.ylabel('Adj. Mutual Information')

plt.legend(loc='best')

plt.show()

for cc in component_counts:

    plt.plot(n_clusters, [ica_gm_results[cc][k]['aic'] for k in n_clusters], label='%i components' % cc)

plt.legend(loc='best')

plt.ylabel('AIC')

plt.xlabel('n_clusters')

plt.show()

for cc in component_counts:

    plt.plot(n_clusters, [ica_gm_results[cc][k]['bic'] for k in n_clusters], label='%i components' % cc)

plt.legend(loc='best')

plt.ylabel('BIC')

plt.xlabel('n_clusters')

plt.show()

# ## RP

component_counts = [1,2,3,4,5,6,7,8,9,10,11,12,13]

n_clusters = np.hstack((

    np.arange(2, 10),

    np.arange(10, 21, 2),

    np.array([30, 40, 50, 60, 80]),

#     np.array([n_samples/2, n_samples], dtype=np.int)

)).astype(np.int)

rp_km_results = {}



for cc in component_counts:

    tmp_dr = SparseRandomProjection(n_components=cc, random_state=0, eps=None)

    tmp_X_tr = tmp_dr.fit_transform(X)

    tmp_res = defaultdict(dict)

    print('Doing %i components' % cc)

    for k in n_clusters:

        km = KMeans(

            n_clusters=k,

            random_state=0

        )

        t0 = time()

        km.fit(tmp_X_tr)

        t = time() - t0

        y_km = km.predict(tmp_X_tr)

        tmp_res[k]['dist'] = km.inertia_

        tmp_res[k]['time'] = t

#         tmp_res[k]['sil'] = silhouette_score(tmp_X_tr, y_km, random_state=0)

        with warnings.catch_warnings():

            warnings.simplefilter("ignore")

            tmp_res[k]['ami'] = ami(y, y_km)

        print('done k=%i in %.3f sec' % (k, t))

    rp_km_results[cc] = tmp_res

for cc in component_counts:

    plt.plot(n_clusters, [rp_km_results[cc][k]['dist'] for k in n_clusters], label='%i components' % cc)



plt.xlabel('n_clusters')

plt.ylabel('Distortion')

plt.legend(loc='best')

plt.show()

for cc in component_counts:

    plt.plot(n_clusters, [rp_km_results[cc][k]['ami'] for k in n_clusters], label='%i components' % cc)

plt.xlabel('n_clusters')

plt.ylabel('Adj. Mutual Information')

plt.legend(loc='best')

plt.show()

rp_gm_results = {}



for cc in component_counts:

    tmp_dr = SparseRandomProjection(n_components=cc, random_state=0, eps=None)

    tmp_X_tr = tmp_dr.fit_transform(X)

    tmp_res = defaultdict(dict)

    print('Doing %i components' % cc)

    tmp_res = defaultdict(dict)

    for k in n_clusters:

        gm = GaussianMixture(

            n_components=k,

            random_state=0,

            n_init=1,

            init_params='kmeans',

        )

        t0 = time()

        gm.fit(tmp_X_tr)

        t = time() - t0

        y_gm = gm.predict(tmp_X_tr)

        tmp_res[k]['bic'] = gm.bic(tmp_X_tr)

        tmp_res[k]['aic'] = gm.aic(tmp_X_tr)

        tmp_res[k]['ll'] = gm.score(tmp_X_tr)

        tmp_res[k]['time'] = t

#         tmp_res[k]['sil'] = silhouette_score(tmp_X_tr, y_gm, random_state=0)

        with warnings.catch_warnings():

            warnings.simplefilter("ignore")

            tmp_res[k]['ami'] = ami(y, y_gm)

        print('done k=%i in %.3f sec' % (k, t))

    rp_gm_results[cc] = tmp_res

for cc in component_counts:

    plt.plot(n_clusters, [rp_gm_results[cc][k]['ll'] for k in n_clusters], label='%i components' % cc)

plt.xlabel('n_clusters')

plt.ylabel('Log likelihood')

# plt.xlim([0, 100])

plt.legend(loc='best')

plt.show()

for cc in component_counts:

    plt.plot(n_clusters, [rp_gm_results[cc][k]['ami'] for k in n_clusters], label='%i components' % cc)

plt.xlabel('n_clusters')

plt.ylabel('Adj. Mutual Information')

plt.legend(loc='best')

plt.show()

for cc in component_counts:

    plt.plot(n_clusters, [rp_gm_results[cc][k]['aic'] for k in n_clusters], label='%i components' % cc)

plt.legend(loc='lower left')

plt.ylabel('AIC')

plt.xlabel('n_clusters')

plt.show()

for cc in component_counts:

    plt.plot(n_clusters, [rp_gm_results[cc][k]['bic'] for k in n_clusters], label='%i components' % cc)

plt.legend(loc='best')

plt.ylabel('BIC')

plt.xlabel('n_clusters')

plt.show()

# ## LDA

component_counts = [1]

component_counts = [1]

lda_km_results = {}



for cc in component_counts:

    tmp_dr = LDA(n_components=None)

    tmp_X_tr = tmp_dr.fit_transform(X, y)

    tmp_res = defaultdict(dict)

    print('Doing %i components' % cc)

    for k in n_clusters:

        km = KMeans(

            n_clusters=k,

            random_state=0

        )

        t0 = time()

        km.fit(tmp_X_tr)

        t = time() - t0

        y_km = km.predict(tmp_X_tr)

        tmp_res[k]['dist'] = km.inertia_

        tmp_res[k]['time'] = t

#         tmp_res[k]['sil'] = silhouette_score(tmp_X_tr, y_km, random_state=0)

        with warnings.catch_warnings():

            warnings.simplefilter("ignore")

            tmp_res[k]['ami'] = ami(y, y_km)

        print('done k=%i in %.3f sec' % (k, t))

    lda_km_results[cc] = tmp_res

for cc in component_counts:

    plt.plot(n_clusters, [lda_km_results[cc][k]['dist'] for k in n_clusters], label='%i components' % cc)



plt.xlabel('n_clusters')

plt.ylabel('Distortion')

plt.legend(loc='best')

plt.show()

for cc in component_counts:

    plt.plot(n_clusters, [lda_km_results[cc][k]['ami'] for k in n_clusters], label='%i components' % cc)

plt.xlabel('n_clusters')

plt.ylabel('Adj. Mutual Information')

plt.legend(loc='best')

plt.show()

lda_gm_results = {}



for cc in component_counts:

    tmp_dr = LDA(n_components=None)

    tmp_X_tr = tmp_dr.fit_transform(X, y)

    tmp_res = defaultdict(dict)

    print('Doing %i components' % cc)

    tmp_res = defaultdict(dict)

    for k in n_clusters:

        gm = GaussianMixture(

            n_components=k,

            random_state=0,

            n_init=1,

            init_params='kmeans',

        )

        t0 = time()

        gm.fit(tmp_X_tr)

        t = time() - t0

        y_gm = gm.predict(tmp_X_tr)

        tmp_res[k]['bic'] = gm.bic(tmp_X_tr)

        tmp_res[k]['aic'] = gm.aic(tmp_X_tr)

        tmp_res[k]['ll'] = gm.score(tmp_X_tr)

        tmp_res[k]['time'] = t

#         tmp_res[k]['sil'] = silhouette_score(tmp_X_tr, y_gm, random_state=0)

        with warnings.catch_warnings():

            warnings.simplefilter("ignore")

            tmp_res[k]['ami'] = ami(y, y_gm)

        print('done k=%i in %.3f sec' % (k, t))

    lda_gm_results[cc] = tmp_res

for cc in component_counts:

    plt.plot(n_clusters, [lda_gm_results[cc][k]['ll'] for k in n_clusters], label='%i components' % cc)

plt.xlabel('n_clusters')

plt.ylabel('Log likelihood')

plt.legend(loc='best')

plt.show()

for cc in component_counts:

    plt.plot(n_clusters, [lda_gm_results[cc][k]['ami'] for k in n_clusters], label='%i components' % cc)

plt.xlabel('n_clusters')

plt.ylabel('Adj. Mutual Information')

plt.legend(loc='best')

plt.show()

for cc in component_counts:

    plt.plot(n_clusters, [lda_gm_results[cc][k]['aic'] for k in n_clusters], label='%i components' % cc)

plt.legend(loc='best')

plt.ylabel('AIC')

plt.xlabel('n_clusters')

plt.show()

for cc in component_counts:

    plt.plot(n_clusters, [lda_gm_results[cc][k]['aic'] for k in n_clusters], label='AIC')

    plt.plot(n_clusters, [lda_gm_results[cc][k]['bic'] for k in n_clusters], label='BIC')

plt.legend(loc='best')

plt.xlabel('n_clusters')

plt.show()
